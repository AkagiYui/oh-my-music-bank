package handler

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/akagiyui/oh-my-music-bank/internal/middleware"
	"github.com/akagiyui/oh-my-music-bank/internal/model"
	"github.com/akagiyui/oh-my-music-bank/internal/service/cache"
	"github.com/akagiyui/oh-my-music-bank/internal/service/session"
	"github.com/akagiyui/oh-my-music-bank/internal/service/site"
	storage "github.com/akagiyui/oh-my-music-bank/internal/storage/db"
	"github.com/gin-gonic/gin"
	"github.com/pressly/goose/v3"
)

func TestSiteSettingsPersistenceAndIsolation(t *testing.T) {
	db := testDB(t)
	c := cache.New(db)
	must(t, c.WarmSettings())
	h := NewSiteHandler(db, c)
	settings := site.FromValues(nil)
	settings.SystemTitle = " 测试音源 "
	settings.HomeTitle = "新的首页"
	settings.HomeDescription = ""
	settings.APIOrigin = "https://API.example.test:8443/"
	settings.LogoURL = "/logo.svg"
	settings.RegistrationEnabled = false
	settings.LogRetentionDays = 30
	must(t, c.SetSetting("xfyun.api_key", "must-not-leak"))
	r := call(t, h.AdminUpdateSettings, "PUT", "/", settings, nil)
	if r.Code != 200 {
		t.Fatal(r.Code, r.Body.String())
	}
	var updated struct {
		Data site.Settings `json:"data"`
	}
	must(t, json.Unmarshal(r.Body.Bytes(), &updated))
	if updated.Data.SystemTitle != "测试音源" || updated.Data.APIOrigin != "https://api.example.test:8443" {
		t.Fatal(updated)
	}
	// 新实例无需预热缓存就能读取数据库中的最新品牌；公开响应不能泄漏管理字段。
	fresh := NewSiteHandler(db, cache.New(db))
	r = call(t, fresh.PublicConfig, "GET", "/", nil, nil)
	var public struct {
		Data map[string]any `json:"data"`
	}
	must(t, json.Unmarshal(r.Body.Bytes(), &public))
	if r.Code != 200 || public.Data["systemTitle"] != "测试音源" || public.Data["homeDescription"] != "" || public.Data["registrationEnabled"] != false {
		t.Fatal(r.Body.String())
	}
	if len(public.Data) != 10 || public.Data["logRetentionDays"] != nil || bytes.Contains(r.Body.Bytes(), []byte("must-not-leak")) {
		t.Fatal("private fields leaked", r.Body.String())
	}
	if r.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("public settings may be cached")
	}
	if c.GetSetting("site.registration_enabled") != "false" {
		t.Fatal("cache not updated")
	}

	before := updated.Data
	invalid := before
	invalid.SystemTitle = "should never persist"
	invalid.APIOrigin = "javascript:alert(1)"
	invalid.LogRetentionDays = 9
	r = call(t, h.AdminUpdateSettings, "PUT", "/", invalid, nil)
	if r.Code != 400 {
		t.Fatal(r.Code, r.Body.String())
	}
	// 在事务后半段强制触发数据库约束错误，验证之前的日志和首页写入全部回滚。
	must(t, db.Exec(`ALTER TABLE settings ADD CONSTRAINT test_brand_failure CHECK (key <> 'site.system_title' OR value <> 'fail-write')`).Error)
	invalid = before
	invalid.SystemTitle = "fail-write"
	invalid.HomeTitle = "must rollback"
	invalid.LogRetentionDays = 1
	r = call(t, h.AdminUpdateSettings, "PUT", "/", invalid, nil)
	if r.Code != 500 {
		t.Fatal(r.Code, r.Body.String())
	}
	r = call(t, fresh.AdminGetSettings, "GET", "/", nil, nil)
	must(t, json.Unmarshal(r.Body.Bytes(), &updated))
	if updated.Data != before || c.GetSetting("site.home_title") != before.HomeTitle {
		t.Fatalf("partial write: %+v", updated.Data)
	}
}

func TestSiteUpdateRejectsLegacyAndMalformedInput(t *testing.T) {
	h := NewSiteHandler(nil, nil)
	for _, body := range []string{`{"brandName":"legacy"}`, `{"systemTitle":"test","unknown":true}`, `null`, `{}`, `[]`, `{"systemTitle":"test"} {}`, `{"systemTitle":12}`} {
		r := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(r)
		c.Request = httptest.NewRequest("PUT", "/", bytes.NewBufferString(body))
		h.AdminUpdateSettings(c)
		if r.Code != 400 {
			t.Fatalf("accepted %s: %d", body, r.Code)
		}
	}
}

func TestSiteUpdateRequiresCompleteTypedSettings(t *testing.T) {
	h := NewSiteHandler(nil, nil)
	body, err := json.Marshal(site.FromValues(nil))
	must(t, err)
	var fields map[string]any
	must(t, json.Unmarshal(body, &fields))
	for key, value := range fields {
		for _, missing := range []bool{true, false} {
			if missing {
				delete(fields, key)
			} else {
				fields[key] = nil
			}
			r := call(t, h.AdminUpdateSettings, "PUT", "/", fields, nil)
			if r.Code != 400 {
				t.Fatalf("accepted missing/null %s: %d", key, r.Code)
			}
		}
		fields[key] = value
	}
}

func TestSiteSettingsRequireAdministrator(t *testing.T) {
	db := testDB(t)
	cfg := testConfig()
	h := NewSiteHandler(db, cache.New(db))
	engine := gin.New()
	group := engine.Group("/settings", middleware.WebAuthMiddleware(cfg, db), middleware.AdminOnly())
	group.GET("", h.AdminGetSettings)
	group.PUT("", h.AdminUpdateSettings)
	for _, role := range []string{"", "user", "admin"} {
		token := ""
		if role != "" {
			u := testUser(t, db, role)
			var err error
			token, _, err = session.New(db, cfg, &u)
			must(t, err)
		}
		for _, method := range []string{"GET", "PUT"} {
			body, _ := json.Marshal(site.FromValues(nil))
			req := httptest.NewRequest(method, "/settings", bytes.NewReader(body))
			if token != "" {
				req.Header.Set("Authorization", "Bearer "+token)
			}
			req.Header.Set("Content-Type", "application/json")
			r := httptest.NewRecorder()
			engine.ServeHTTP(r, req)
			want := 200
			if role == "" {
				want = 401
			} else if role == "user" {
				want = 403
			}
			if r.Code != want {
				t.Fatalf("%s %s got %d: %s", role, method, r.Code, r.Body.String())
			}
		}
	}
}

func TestBrandingMigrationRoundTrip(t *testing.T) {
	db := testDB(t)
	sql, err := db.DB()
	must(t, err)
	must(t, goose.DownTo(sql, "migrations", 4))
	must(t, db.Model(&model.Setting{}).Where("key = ?", "site.brand_name").Update("value", "已有品牌").Error)
	must(t, storage.Migrate(db))
	var title model.Setting
	must(t, db.First(&title, "key = ?", "site.system_title").Error)
	if title.Value != "已有品牌" {
		t.Fatal(title.Value)
	}
	var count int64
	must(t, db.Model(&model.Setting{}).Where("key = ?", "site.brand_name").Count(&count).Error)
	if count != 0 {
		t.Fatal("legacy key survives")
	}
	must(t, goose.DownTo(sql, "migrations", 4))
	title = model.Setting{}
	must(t, db.First(&title, "key = ?", "site.brand_name").Error)
	if title.Value != "已有品牌" {
		t.Fatal(title.Value)
	}
	must(t, storage.Migrate(db))
}

func TestDefaultBrandCopyMigration(t *testing.T) {
	db := testDB(t)
	sql, err := db.DB()
	must(t, err)
	read := func() site.Config {
		t.Helper()
		r := call(t, NewSiteHandler(db, cache.New(db)).PublicConfig, "GET", "/", nil, nil)
		if r.Code != 200 {
			t.Fatal(r.Code, r.Body.String())
		}
		var result struct {
			Data site.Config `json:"data"`
		}
		must(t, json.Unmarshal(r.Body.Bytes(), &result))
		return result.Data
	}
	// 新建数据库和缺失配置时的默认值必须一致，包含新增的默认页脚。
	defaults := site.FromValues(nil).Config
	if got := read(); got != defaults {
		t.Fatalf("migration and runtime defaults differ: %+v", got)
	}
	// 定位文案迁移的前一版本，不假定它永远是最新迁移。
	must(t, goose.DownTo(sql, "migrations", 5))
	old := read()
	if old == defaults {
		t.Fatal("default copy was not rolled back")
	}
	must(t, storage.Migrate(db))
	if got := read(); got != defaults {
		t.Fatalf("default copy not restored: %+v", got)
	}

	// 已有站点只要一项文案自定义（包括主动清空），升级和回退就不得覆盖其内容。
	must(t, goose.DownTo(sql, "migrations", 5))
	must(t, db.Model(&model.Setting{}).Where("key = ?", "site.description").Update("value", "").Error)
	custom := read()
	must(t, storage.Migrate(db))
	if got := read(); got != custom {
		t.Fatalf("custom copy overwritten during upgrade: %+v", got)
	}
	must(t, goose.DownTo(sql, "migrations", 5))
	if got := read(); got != custom {
		t.Fatalf("custom copy overwritten during rollback: %+v", got)
	}
	must(t, storage.Migrate(db))

	must(t, db.Model(&model.Setting{}).Where("key = ?", "site.footer_text").Update("value", "").Error)
	if got := read(); got.FooterText != "" {
		t.Fatalf("explicit empty footer replaced by default: %+v", got)
	}
}
