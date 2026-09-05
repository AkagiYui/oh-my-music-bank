package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/akagiyui/oh-my-music-bank/internal/middleware"
	"github.com/akagiyui/oh-my-music-bank/internal/model"
	"github.com/akagiyui/oh-my-music-bank/internal/service/bilibili"
	"github.com/akagiyui/oh-my-music-bank/internal/service/cache"
	"github.com/akagiyui/oh-my-music-bank/internal/service/session"
	storage "github.com/akagiyui/oh-my-music-bank/internal/storage/db"
	"github.com/akagiyui/oh-my-music-bank/internal/storage/objectstore"
	"github.com/gin-gonic/gin"
	"github.com/pressly/goose/v3"
)

type fakeBiliAccounts struct {
	mid        string
	profileErr error
	refresh    func(bilibili.Credentials) (bilibili.Credentials, bool, error)
	confirm    func(string, string) error
}

func (f *fakeBiliAccounts) GenerateQR(context.Context) (bilibili.QRCode, error) {
	return bilibili.QRCode{URL: "https://passport.bilibili.com/qr", Key: "private-qr"}, nil
}
func (f *fakeBiliAccounts) PollQR(context.Context, string) (string, bilibili.Credentials, error) {
	return "success", bilibili.Credentials{Cookie: "DedeUserID=" + f.mid + "; SESSDATA=secret-session; bili_jct=secret-csrf", RefreshToken: "secret-refresh"}, nil
}
func (f *fakeBiliAccounts) Profile(_ context.Context, cookie string) (bilibili.Profile, error) {
	r := http.Request{Header: http.Header{"Cookie": []string{cookie}}}
	c, _ := r.Cookie("DedeUserID")
	mid := int64(123)
	if c != nil {
		mid, _ = strconv.ParseInt(c.Value, 10, 64)
	}
	return bilibili.Profile{MID: mid, Name: "账号 " + strconv.FormatInt(mid, 10), IsLogin: true}, f.profileErr
}
func (f *fakeBiliAccounts) RefreshCookies(_ context.Context, c bilibili.Credentials) (bilibili.Credentials, bool, error) {
	if f.refresh != nil {
		return f.refresh(c)
	}
	return c, false, nil
}
func (f *fakeBiliAccounts) ConfirmRefresh(_ context.Context, cookie, token string) error {
	if f.confirm != nil {
		return f.confirm(cookie, token)
	}
	return nil
}

func TestBilibiliAccountsLoginIsolationAndDeduplication(t *testing.T) {
	db := testDB(t)
	user := testUser(t, db, "admin")
	other := testUser(t, db, "admin")
	fake := &fakeBiliAccounts{mid: "9007199254740993"}
	a := bilibili.NewAccounts(db, fake)
	ctx := context.Background()
	login, err := a.CreateLogin(ctx, user.ID)
	must(t, err)
	if _, err = a.PollLogin(ctx, other.ID, login.ID); err == nil {
		t.Fatal("cross-user QR polling accepted")
	}
	result, err := a.PollLogin(ctx, user.ID, login.ID)
	must(t, err)
	first := result.Account.ID
	if !result.Account.IsDefault || *result.Account.MID != fake.mid {
		t.Fatal("first account/default/string UID lost")
	}
	_, err = a.PollLogin(ctx, user.ID, login.ID)
	must(t, err)
	login, err = a.CreateLogin(ctx, user.ID)
	must(t, err)
	result, err = a.PollLogin(ctx, user.ID, login.ID)
	must(t, err)
	if result.Account.ID != first {
		t.Fatal("same UID duplicated")
	}
	rows, err := a.List(ctx)
	must(t, err)
	b, _ := json.Marshal(rows)
	if len(rows) != 1 || strings.Contains(string(b), "secret") || strings.Contains(string(b), "refreshToken") {
		t.Fatal("account list duplicated or leaked credentials")
	}
	fake.mid = "456"
	login, err = a.CreateLogin(ctx, user.ID)
	must(t, err)
	result, err = a.PollLogin(ctx, user.ID, login.ID)
	must(t, err)
	second := result.Account.ID
	if result.Account.IsDefault {
		t.Fatal("adding account unexpectedly switched default")
	}
	must(t, a.SetDefault(ctx, second))
	current, err := a.Get(ctx, "")
	must(t, err)
	if current.ID != second {
		t.Fatal("switch did not persist")
	}
	must(t, a.Delete(ctx, second))
	current, err = a.Get(ctx, "")
	must(t, err)
	if current.ID != first {
		t.Fatal("removing default did not choose remaining account")
	}
	if _, err = a.Credentials(ctx, second); err == nil {
		t.Fatal("removed explicit account silently fell back")
	}
	must(t, a.Delete(ctx, first))
	if _, err = a.Get(ctx, ""); err == nil {
		t.Fatal("last account survived deletion")
	}
}

func TestBilibiliRefreshPersistenceConcurrencyAndRecovery(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	mid := "123"
	row := model.BilibiliAccount{ID: "account", MID: &mid, Name: "old", Cookie: "DedeUserID=123; SESSDATA=old; bili_jct=old", RefreshToken: "old-token", IsDefault: true, Status: "active"}
	must(t, db.Create(&row).Error)
	var rotations atomic.Int32
	var confirms atomic.Int32
	fake := &fakeBiliAccounts{}
	fake.refresh = func(c bilibili.Credentials) (bilibili.Credentials, bool, error) {
		rotations.Add(1)
		return bilibili.Credentials{Cookie: "DedeUserID=123; SESSDATA=new; bili_jct=new", RefreshToken: "new-token"}, true, nil
	}
	fake.confirm = func(cookie, token string) error {
		var committed model.BilibiliAccount
		must(t, db.First(&committed, "id = ?", row.ID).Error)
		if committed.RefreshToken != "new-token" || committed.Cookie != cookie || token != "old-token" {
			t.Error("confirmation before durable commit or incorrect old token")
		}
		confirms.Add(1)
		return errors.New("temporary network failure")
	}
	a := bilibili.NewAccounts(db, fake)
	v, err := a.Refresh(ctx, row.ID, true)
	must(t, err)
	if !v.ConfirmPending || v.LastRefreshedAt == nil {
		t.Fatal("pending confirmation not persisted")
	}
	// 重建服务模拟进程重启，使用新 Cookie 重试确认，不重复轮换。
	fake.confirm = func(cookie, token string) error {
		confirms.Add(1)
		if token != "old-token" {
			t.Error("old token lost")
		}
		return nil
	}
	fake.refresh = func(c bilibili.Credentials) (bilibili.Credentials, bool, error) { return c, false, nil }
	a = bilibili.NewAccounts(db, fake)
	v, err = a.Refresh(ctx, row.ID, false)
	must(t, err)
	if v.ConfirmPending || rotations.Load() != 1 || confirms.Load() != 2 {
		t.Fatal("confirmation recovery failed")
	}
	// 十二小时持久化节流也适用于多个服务实例同时调用。
	must(t, db.Model(&row).Update("last_checked_at", nil).Error)
	rotations.Store(0)
	fake.refresh = func(c bilibili.Credentials) (bilibili.Credentials, bool, error) {
		rotations.Add(1)
		return c, false, nil
	}
	var wg sync.WaitGroup
	for range 4 {
		wg.Go(func() {
			_, e := bilibili.NewAccounts(db, fake).Refresh(ctx, row.ID, false)
			if e != nil {
				t.Error(e)
			}
		})
	}
	wg.Wait()
	if rotations.Load() != 1 {
		t.Fatal("concurrent refresh was not serialized")
	}
	fake.profileErr = errors.New("temporary network error")
	_, err = a.Refresh(ctx, row.ID, true)
	if err == nil {
		t.Fatal("network error hidden")
	}
	current, err := a.Get(ctx, row.ID)
	must(t, err)
	if current.Status != "active" || current.RefreshToken != "new-token" {
		t.Fatal("network failure destroyed credentials")
	}
	fake.profileErr = bilibili.ErrLoginExpired
	_, err = a.Refresh(ctx, row.ID, true)
	if !errors.Is(err, bilibili.ErrLoginExpired) {
		t.Fatal("expiry not reported")
	}
	current, err = a.Get(ctx, row.ID)
	must(t, err)
	if current.Status != "expired" {
		t.Fatal("expiry not persisted")
	}
}

func TestBilibiliLegacyMigrationAndPinnedJobs(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	user := testUser(t, db, "admin")
	sql, err := db.DB()
	must(t, err)
	// 回退到 B 站账号迁移之前的版本，而不是只回退最新一个迁移，否则新增迁移后旧 Cookie 升级路径不会重跑。
	must(t, goose.DownTo(sql, "migrations", 6))
	cookie := "SESSDATA=legacy; DedeUserID=123; bili_jct=csrf"
	must(t, db.Create(&model.Setting{Key: "bilibili.cookie", Value: cookie}).Error)
	job := model.IngestJob{ID: "11111111-1111-4111-8111-111111111111", UserID: user.ID, Kind: "bilibili", Payload: `{"bvid":"BVtest","cid":123}`, Status: "queued", Stage: "等待处理"}
	must(t, db.Create(&job).Error)
	must(t, storage.Migrate(db))
	a := bilibili.NewAccounts(db, &fakeBiliAccounts{mid: "123"})
	rows, err := a.List(ctx)
	must(t, err)
	if len(rows) != 1 || rows[0].Cookie != cookie || rows[0].CanRefresh || !rows[0].IsDefault || rows[0].MID == nil || *rows[0].MID != "123" {
		t.Fatal("legacy cookie migration failed")
	}
	must(t, db.First(&job, "id = ?", job.ID).Error)
	var payload BiliIngestRequest
	must(t, json.Unmarshal([]byte(job.Payload), &payload))
	if payload.AccountID != "legacy" {
		t.Fatal("pre-upgrade job account not pinned")
	}
	login, err := a.CreateLogin(ctx, user.ID)
	must(t, err)
	r, err := a.PollLogin(ctx, user.ID, login.ID)
	must(t, err)
	if r.Account.ID != "legacy" || !r.Account.CanRefresh {
		t.Fatal("legacy re-login did not upgrade in place")
	}
	// 任务提交时绑定默认账号，后续默认切换不会修改任务负载。
	h := NewBilibiliHandler(db, objectstore.Stores{}, cache.New(db), bilibili.New())
	jobs := NewJobs(db, objectstore.Stores{}, h, 1024)
	resp := call(t, func(c *gin.Context) { c.Set("user_id", user.ID); jobs.Bilibili(c) }, "POST", "/jobs", gin.H{"items": []BiliIngestRequest{{Bvid: "BVtest", Cid: 123}}}, nil)
	if resp.Code != 202 {
		t.Fatalf("job submit %d: %s", resp.Code, resp.Body.String())
	}
	var queued model.IngestJob
	must(t, db.Order("created_at DESC").First(&queued).Error)
	must(t, json.Unmarshal([]byte(queued.Payload), &payload))
	if payload.AccountID != "legacy" || strings.Contains(queued.Payload, "SESSDATA") {
		t.Fatal("job failed to pin ID or persisted credentials")
	}
}

func TestBilibiliLoginExpiryAndGeneration(t *testing.T) {
	db := testDB(t)
	user := testUser(t, db, "admin")
	a := bilibili.NewAccounts(db, &fakeBiliAccounts{mid: "123"})
	ctx := context.Background()
	old, err := a.CreateLogin(ctx, user.ID)
	must(t, err)
	newLogin, err := a.CreateLogin(ctx, user.ID)
	must(t, err)
	if _, err := a.PollLogin(ctx, user.ID, old.ID); err == nil {
		t.Fatal("replaced QR still usable")
	}
	must(t, db.Model(&model.BilibiliLogin{}).Where("id = ?", newLogin.ID).Update("expires_at", time.Now().Add(-time.Minute)).Error)
	v, err := a.PollLogin(ctx, user.ID, newLogin.ID)
	must(t, err)
	if v.Status != "expired" {
		t.Fatal("expired QR accepted")
	}
}

func TestBilibiliMediaTokenPinsAccountAndHonorsDeletion(t *testing.T) {
	db := testDB(t)
	user := testUser(t, db, "admin")
	cfg := testConfig()
	access, _, err := session.New(db, cfg, &user)
	must(t, err)
	claims, err := session.Parse(cfg, access, "access")
	must(t, err)
	now := time.Now()
	mid := "123"
	account := model.BilibiliAccount{ID: "account-a", MID: &mid, Name: "A", Cookie: "SESSDATA=unused", IsDefault: true, Status: "active", LastCheckedAt: &now}
	must(t, db.Create(&account).Error)
	h := NewBilibiliHandler(db, objectstore.Stores{}, cache.New(db), bilibili.New())
	r := call(t, func(c *gin.Context) {
		c.Set("media_auth", cfg)
		c.Set(middleware.CtxUserID, user.ID)
		c.Set("session_id", claims.SessionID)
		h.MediaToken(c)
	}, "POST", "/media-token", gin.H{"bvid": "BVtest", "cid": 123}, nil)
	if r.Code != 200 {
		t.Fatal(r.Code, r.Body.String())
	}
	var result struct {
		Data struct {
			URL string `json:"url"`
		} `json:"data"`
	}
	must(t, json.Unmarshal(r.Body.Bytes(), &result))
	u, err := url.Parse(result.Data.URL)
	must(t, err)
	if u.Query().Get("accountId") != account.ID {
		t.Fatal("media token did not resolve default account")
	}
	engine := gin.New()
	engine.GET("/api/v1/admin/bilibili/stream", middleware.MediaTokenAuth(cfg, db), func(c *gin.Context) {
		if _, ok := h.requireAccount(c); ok {
			c.Status(204)
		}
	})
	r = httptest.NewRecorder()
	engine.ServeHTTP(r, httptest.NewRequest("GET", result.Data.URL, nil))
	if r.Code != 204 {
		t.Fatal("valid scoped media token rejected", r.Code)
	}
	r = httptest.NewRecorder()
	engine.ServeHTTP(r, httptest.NewRequest("GET", strings.Replace(result.Data.URL, "account-a", "account-b", 1), nil))
	if r.Code != 401 {
		t.Fatal("account tampering accepted")
	}
	must(t, h.accounts.Delete(context.Background(), account.ID))
	r = httptest.NewRecorder()
	engine.ServeHTTP(r, httptest.NewRequest("GET", result.Data.URL, nil))
	if r.Code == 204 {
		t.Fatal("deleted account remained accessible through old token")
	}
}

func TestBilibiliAccountHandlersRejectNonAdminsAndLegacyWrites(t *testing.T) {
	db := testDB(t)
	user := testUser(t, db, "user")
	cfg := testConfig()
	access, _, err := session.New(db, cfg, &user)
	must(t, err)
	h := NewBilibiliHandler(db, objectstore.Stores{}, cache.New(db), bilibili.New())
	engine := gin.New()
	group := engine.Group("/bilibili", middleware.WebAuthMiddleware(cfg, db), middleware.AdminOnly())
	group.GET("/accounts", h.Accounts)
	group.POST("/login", h.CreateLogin)
	group.POST("/login/:loginId/poll", h.PollLogin)
	group.POST("/accounts/:accountId/refresh", h.RefreshAccount)
	group.DELETE("/accounts/:accountId", h.DeleteAccount)
	for _, endpoint := range []struct{ method, path string }{{"GET", "/accounts"}, {"POST", "/login"}, {"POST", "/login/id/poll"}, {"POST", "/accounts/id/refresh"}, {"DELETE", "/accounts/id"}} {
		for _, token := range []string{"", access} {
			r := httptest.NewRecorder()
			req := httptest.NewRequest(endpoint.method, "/bilibili"+endpoint.path, nil)
			if token != "" {
				req.Header.Set("Authorization", "Bearer "+token)
			}
			engine.ServeHTTP(r, req)
			want := 401
			if token != "" {
				want = 403
			}
			if r.Code != want {
				t.Fatal("account route authorization failed", endpoint.path, r.Code)
			}
		}
	}
	resp := call(t, NewIntegrationsHandler(cache.New(db), nil, "").Update, "PUT", "/integrations", gin.H{"bilibiliCookie": "SESSDATA=must-not-be-saved"}, nil)
	if resp.Code != 400 {
		t.Fatal("old cookie import endpoint remains writable")
	}
}
