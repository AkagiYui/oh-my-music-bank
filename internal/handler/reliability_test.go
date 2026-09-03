package handler

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"github.com/akagiyui/oh-my-music-bank/internal/config"
	"github.com/akagiyui/oh-my-music-bank/internal/middleware"
	"github.com/akagiyui/oh-my-music-bank/internal/model"
	"github.com/akagiyui/oh-my-music-bank/internal/service/bilibili"
	"github.com/akagiyui/oh-my-music-bank/internal/service/cache"
	"github.com/akagiyui/oh-my-music-bank/internal/service/objectgc"
	"github.com/akagiyui/oh-my-music-bank/internal/service/session"
	storage "github.com/akagiyui/oh-my-music-bank/internal/storage/db"
	"github.com/akagiyui/oh-my-music-bank/internal/storage/objectstore"
	"github.com/akagiyui/oh-my-music-bank/pkg/keys"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/pressly/goose/v3"
	"gorm.io/gorm"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func testDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("OMMB_TEST_DSN")
	if dsn == "" {
		t.Skip("set OMMB_TEST_DSN to run isolated PostgreSQL regression tests")
	}
	root, e := storage.Init(dsn, 10, 2, 60, 60)
	if e != nil {
		t.Fatal(e)
	}
	name := "ommb_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if e = root.Exec("CREATE DATABASE " + name).Error; e != nil {
		t.Fatal(e)
	}
	u, e := url.Parse(dsn)
	if e != nil {
		t.Fatal(e)
	}
	u.Path = "/" + name
	db, e := storage.Init(u.String(), 20, 5, 60, 60)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() {
		sql, _ := db.DB()
		sql.Close()
		root.Exec("DROP DATABASE " + name + " WITH (FORCE)")
		sql, _ = root.DB()
		sql.Close()
	})
	if e = storage.Migrate(db); e != nil {
		t.Fatal(e)
	}
	return db
}
func must(t *testing.T, e error) {
	t.Helper()
	if e != nil {
		t.Fatal(e)
	}
}
func testConfig() config.Auth {
	return config.Auth{JWTSecret: strings.Repeat("t", 32), AccessTokenTTL: "15m", RefreshTokenTTL: "24h"}
}
func testUser(t *testing.T, db *gorm.DB, role string) model.User {
	u := model.User{Username: uuid.NewString(), Email: uuid.NewString() + "@test.invalid", PasswordHash: "unused", Role: role, IsActive: true}
	must(t, db.Create(&u).Error)
	return u
}
func call(t *testing.T, handler gin.HandlerFunc, method, target string, body any, params gin.Params) *httptest.ResponseRecorder {
	t.Helper()
	b, _ := json.Marshal(body)
	r := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(r)
	c.Request = httptest.NewRequest(method, target, bytes.NewReader(b))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Params = params
	handler(c)
	c.Writer.WriteHeaderNow()
	return r
}
func TestSessionsAndDisabledKeys(t *testing.T) {
	db := testDB(t)
	u := testUser(t, db, "admin")
	cfg := testConfig()
	access, refresh, e := session.New(db, cfg, &u)
	must(t, e)
	if _, _, e = session.Refresh(db, cfg, access); e == nil {
		t.Fatal("access refreshed")
	}
	_, next, e := session.Refresh(db, cfg, refresh)
	must(t, e)
	if _, _, e = session.Refresh(db, cfg, refresh); e == nil {
		t.Fatal("refresh replay succeeded")
	}
	claims, e := session.Parse(cfg, access, "access")
	must(t, e)
	_, e = session.User(db, claims)
	must(t, e)
	key, _ := keys.Generate()
	k := model.APIKey{UserID: u.ID, KeyHash: keys.Hash(key), KeyPrefix: keys.DisplayPrefix(key)}
	must(t, db.Create(&k).Error)
	other := testUser(t, db, "admin")
	_ = other
	must(t, NewUserHandler(db).mutateUser(u.ID, map[string]any{"is_active": false}, false))
	if _, e = session.User(db, claims); e == nil {
		t.Fatal("disabled session survived")
	}
	if _, _, e = session.Refresh(db, cfg, next); e == nil {
		t.Fatal("disabled refresh survived")
	}
	r := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(r)
	c.Request = httptest.NewRequest("GET", "/", nil)
	c.Request.Header.Set("X-API-Key", key)
	middleware.APIKeyAuthMiddleware(db)(c)
	if r.Code != 401 {
		t.Fatalf("disabled key status %d", r.Code)
	}
}
func TestConcurrentAdministratorBootstrap(t *testing.T) {
	db := testDB(t)
	cfg := testConfig()
	h := NewAuthHandler(db, cfg, cache.New(db))
	var wg sync.WaitGroup
	codes := make(chan int, 2)
	for i := range 2 {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			r := call(t, h.Register, "POST", "/", map[string]string{"username": fmt.Sprintf("user%d", i), "email": fmt.Sprintf("u%d@test.invalid", i), "password": "test-password"}, nil)
			codes <- r.Code
		}(i)
	}
	wg.Wait()
	close(codes)
	for code := range codes {
		if code != 201 {
			t.Fatalf("registration status %d", code)
		}
	}
	var n int64
	must(t, db.Model(&model.User{}).Where("role='admin'").Count(&n).Error)
	if n != 1 {
		t.Fatalf("admin count %d", n)
	}
	var admin model.User
	must(t, db.Where("role='admin'").First(&admin).Error)
	if e := NewUserHandler(db).mutateUser(admin.ID, map[string]any{"role": "user"}, false); e == nil {
		t.Fatal("last admin demoted")
	}
	if e := NewUserHandler(db).mutateUser(admin.ID, map[string]any{"is_active": false}, false); e == nil {
		t.Fatal("last admin disabled")
	}
}

// fakeStore 用两个独立的 httptest 服务模拟公共桶与私有桶，验证两套连接互不共享。
func fakeStore(t *testing.T) (objectstore.Stores, *sync.Map) {
	objects := &sync.Map{}
	newServer := func(bucket string) *httptest.Server {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// 桶名之外的路径即对象 key；BucketExists 会 HEAD 桶根路径。
			if r.URL.Path == "/"+bucket || r.URL.Path == "/"+bucket+"/" {
				w.WriteHeader(200)
				return
			}
			key := strings.TrimPrefix(r.URL.Path, "/"+bucket+"/")
			switch r.Method {
			case "PUT":
				b, _ := io.ReadAll(r.Body)
				objects.Store(key, b)
				w.Header().Set("ETag", "\"test\"")
			case "DELETE":
				objects.Delete(key)
				w.WriteHeader(204)
			case "GET", "HEAD":
				v, ok := objects.Load(key)
				if !ok {
					w.WriteHeader(404)
					return
				}
				w.Header().Set("Content-Type", "audio/wav")
				w.Header().Set("Last-Modified", time.Now().UTC().Format(http.TimeFormat))
				http.ServeContent(w, r, key, time.Now(), bytes.NewReader(v.([]byte)))
			default:
				w.WriteHeader(400)
			}
		}))
		t.Cleanup(server.Close)
		return server
	}
	pub, priv := newServer("public"), newServer("private")
	store, e := objectstore.New(config.Storage{
		Public: config.PublicStorage{
			S3:      config.S3{Endpoint: pub.URL, AccessKey: "public-test", SecretKey: "public-only", Bucket: "public", Region: "us-east-1"},
			BaseURL: pub.URL + "/public",
		},
		Private: config.PrivateStorage{
			S3:              config.S3{Endpoint: priv.URL, AccessKey: "private-test", SecretKey: "private-only", Bucket: "private", Region: "us-east-1"},
			PresignedURLTTL: "30m",
		},
	})
	must(t, e)
	must(t, store.Check(context.Background()))
	return store, objects
}
func testWAV(t *testing.T) string {
	t.Helper()
	if _, e := exec.LookPath("ffmpeg"); e != nil {
		t.Skip("ffmpeg required")
	}
	if _, e := exec.LookPath("ffprobe"); e != nil {
		t.Skip("ffprobe required")
	}
	var b bytes.Buffer
	b.WriteString("RIFF")
	binary.Write(&b, binary.LittleEndian, uint32(36+32000))
	b.WriteString("WAVEfmt ")
	for _, v := range []any{uint32(16), uint16(1), uint16(1), uint32(16000), uint32(32000), uint16(2), uint16(16)} {
		binary.Write(&b, binary.LittleEndian, v)
	}
	b.WriteString("data")
	binary.Write(&b, binary.LittleEndian, uint32(32000))
	b.Write(make([]byte, 32000))
	p := filepath.Join(t.TempDir(), "test.wav")
	must(t, os.WriteFile(p, b.Bytes(), 0600))
	return p
}
func TestConcurrentDedupAndSharedObjectDeletion(t *testing.T) {
	db := testDB(t)
	store, objects := fakeStore(t)
	p := testWAV(t)
	var wg sync.WaitGroup
	tracks := make(chan int64, 2)
	errs := make(chan error, 2)
	for range 2 {
		wg.Go(func() {
			track, _, e := ingestAudioFile(context.Background(), db, store, p, "wav", ingestOptions{Title: "Test"})
			errs <- e
			if e == nil {
				tracks <- track.ID
			}
		})
	}
	wg.Wait()
	close(errs)
	for e := range errs {
		must(t, e)
	}
	a, b := <-tracks, <-tracks
	if a != b {
		t.Fatal("duplicate tracks")
	}
	var audio model.Audio
	must(t, db.Where("track_id = ?", a).First(&audio).Error)
	r := call(t, NewAudioHandler(db, store, config.Upload{MaxSizeMB: 10}).DeleteAudio, "DELETE", "/", nil, gin.Params{{Key: "id", Value: audio.ID}})
	if r.Code != 204 {
		t.Fatalf("delete audio %d: %s", r.Code, r.Body.String())
	}
	must(t, objectgc.Collect(context.Background(), db, store))
	if _, ok := objects.Load(audio.FileKey); !ok {
		t.Fatal("original object deleted while referenced")
	}
	var origin model.OriginAudio
	must(t, db.Where("track_id = ?", a).First(&origin).Error)
	r = call(t, NewTrackHandler(db, store.Public).Delete, "DELETE", "/", nil, gin.Params{{Key: "id", Value: itoa(a)}})
	if r.Code != 204 {
		t.Fatal(r.Body.String())
	}
	must(t, objectgc.Collect(context.Background(), db, store))
	if _, ok := objects.Load(audio.FileKey); ok {
		t.Fatal("unreferenced object was not removed")
	}
}
func TestMetadataAtomicAndSearchAlias(t *testing.T) {
	db := testDB(t)
	store, _ := fakeStore(t)
	track := model.Track{Title: "Original", Available: true, ID: 100}
	must(t, db.Create(&track).Error)
	artist := model.Artist{Name: "Artist", ID: 101}
	must(t, db.Create(&artist).Error)
	must(t, db.Create(&model.ArtistAlias{ArtistID: 101, Alias: "别名测试"}).Error)
	must(t, db.Create(&model.TrackArtist{TrackID: 100, ArtistID: 101}).Error)
	r := call(t, NewPublicHandler(db, store.Public).Search, "GET", "/?q="+url.QueryEscape("别名测试"), nil, nil)
	if r.Code != 200 || !strings.Contains(r.Body.String(), "Original") {
		t.Fatalf("alias search: %s", r.Body.String())
	}
	r = call(t, NewMetadataHandler(db, store.Public).Enrich, "POST", "/", map[string]any{"title": "Changed", "artists": []string{strings.Repeat("x", 300)}}, gin.Params{{Key: "id", Value: "100"}})
	if r.Code != 422 {
		t.Fatalf("enrich %d: %s", r.Code, r.Body.String())
	}
	must(t, db.First(&track, 100).Error)
	if track.Title != "Original" {
		t.Fatal("partial metadata update committed")
	}
}
func TestJobsCancelRetryAndCompletion(t *testing.T) {
	db := testDB(t)
	store, _ := fakeStore(t)
	u := testUser(t, db, "admin")
	jobs := NewJobs(db, store, NewBilibiliHandler(db, store, cache.New(db), bilibili.New()), 10<<20)
	payload, _ := json.Marshal(uploadPayload{Title: "Job", Ext: ".wav"})
	job := model.IngestJob{ID: uuid.NewString(), UserID: u.ID, Kind: "upload", Payload: string(payload), InputKey: "staging/test.wav", Status: "queued"}
	must(t, db.Create(&job).Error)
	r := call(t, jobs.Cancel, "POST", "/", nil, gin.Params{{Key: "id", Value: job.ID}})
	if r.Code != 204 {
		t.Fatal(r.Body.String())
	}
	must(t, db.First(&job, "id = ?", job.ID).Error)
	if job.Status != "cancelled" {
		t.Fatal(job.Status)
	}
	r = call(t, jobs.Retry, "POST", "/", nil, gin.Params{{Key: "id", Value: job.ID}})
	if r.Code != 204 {
		t.Fatal(r.Body.String())
	}
	// 模拟处理节点丢失：失败会记录并允许重试。
	jobs.process(context.Background())
	must(t, db.First(&job, "id = ?", job.ID).Error)
	if job.Status != "failed" || job.ErrorMessage == "" {
		t.Fatalf("job=%+v", job)
	}
}

func TestMergePreservesVersionsAndRelationships(t *testing.T) {
	db := testDB(t)
	store, _ := fakeStore(t)
	for _, id := range []int64{201, 202} {
		track := model.Track{Title: fmt.Sprint(id), Available: true, ID: id}
		must(t, db.Create(&track).Error)
		must(t, db.Create(&model.Audio{TrackID: id, FileKey: fmt.Sprint(id), QualityLabel: "standard"}).Error)
	}
	r := call(t, NewTrackHandler(db, store.Public).Merge, "POST", "/", map[string]string{"targetId": "202"}, gin.Params{{Key: "id", Value: "201"}})
	if r.Code != 200 {
		t.Fatalf("merge %d: %s", r.Code, r.Body.String())
	}
	var count int64
	must(t, db.Model(&model.Audio{}).Where("track_id = 202").Count(&count).Error)
	if count != 2 {
		t.Fatal("lost audio version")
	}
	must(t, db.Model(&model.Track{}).Where("id=201").Count(&count).Error)
	if count != 0 {
		t.Fatal("source not merged")
	}
	for _, id := range []int64{301, 302} {
		a := model.Artist{Name: fmt.Sprint(id), ID: id}
		must(t, db.Create(&a).Error)
		must(t, db.Create(&model.TrackArtist{TrackID: 202, ArtistID: id}).Error)
	}
	r = call(t, NewArtistHandler(db, store.Public).Merge, "POST", "/", map[string]string{"targetId": "302"}, gin.Params{{Key: "id", Value: "301"}})
	if r.Code != 200 {
		t.Fatal(r.Body.String())
	}
	must(t, db.Model(&model.TrackArtist{}).Where("track_id=202").Count(&count).Error)
	if count != 1 {
		t.Fatal("duplicate or lost artist")
	}
}
func TestJobSuccessAndLeaseRecovery(t *testing.T) {
	db := testDB(t)
	store, objects := fakeStore(t)
	u := testUser(t, db, "admin")
	jobs := NewJobs(db, store, NewBilibiliHandler(db, store, cache.New(db), bilibili.New()), 10<<20)
	wav, e := os.ReadFile(testWAV(t))
	must(t, e)
	objects.Store("staging/success.wav", wav)
	payload, _ := json.Marshal(uploadPayload{Title: "Job", Ext: ".wav"})
	expired := time.Now().Add(-time.Minute)
	oldRun := uuid.NewString()
	job := model.IngestJob{ID: uuid.NewString(), UserID: u.ID, Kind: "upload", Payload: string(payload), InputKey: "staging/success.wav", Status: "processing", RunID: &oldRun, LeaseUntil: &expired}
	must(t, db.Create(&job).Error)
	jobs.process(context.Background())
	must(t, db.First(&job, "id = ?", job.ID).Error)
	if job.Status != "ready" || job.TrackID == nil {
		t.Fatalf("job did not recover: %+v", job)
	}
	var n int64
	must(t, db.Model(&model.Track{}).Count(&n).Error)
	if n != 1 {
		t.Fatalf("tracks=%d", n)
	}
	jobs.process(context.Background())
	must(t, db.Model(&model.Track{}).Count(&n).Error)
	if n != 1 {
		t.Fatal("job repeated")
	}
}
func TestRateLimitAndRejectedRequestAudit(t *testing.T) {
	db := testDB(t)
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(middleware.APILogMiddleware(db), middleware.IPRateLimit(db, "test:", 2))
	engine.GET("/test", func(c *gin.Context) { c.Status(200) })
	for i := range 3 {
		r := httptest.NewRecorder()
		engine.ServeHTTP(r, httptest.NewRequest("GET", "/test", nil))
		want := 200
		if i == 2 {
			want = 429
		}
		if r.Code != want {
			t.Fatalf("request %d status %d", i, r.Code)
		}
	}
	var n int64
	must(t, db.Model(&model.APIRequestLog{}).Where("status_code=429").Count(&n).Error)
	if n != 1 {
		t.Fatal("rejected request not audited")
	}
}
func TestPrivateMediaPresignedURLs(t *testing.T) {
	db := testDB(t)
	store, _ := fakeStore(t)
	track := model.Track{Title: "Media", Available: true, ID: 400}
	must(t, db.Create(&track).Error)
	a := model.Audio{TrackID: 400, FileKey: "media.wav", QualityLabel: "standard"}
	must(t, db.Create(&a).Error)
	h := NewAudioHandler(db, store, config.Upload{MaxSizeMB: 10})
	r := call(t, h.PublicPlaybackURL, "POST", "/", nil, gin.Params{{Key: "id", Value: a.ID}})
	if r.Code != 200 || !strings.Contains(r.Body.String(), "X-Amz-Signature") || r.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("public presign %d: %s", r.Code, r.Body.String())
	}
	must(t, db.Model(&track).Update("available", false).Error)
	r = call(t, h.PublicPlaybackURL, "POST", "/", nil, gin.Params{{Key: "id", Value: a.ID}})
	if r.Code != 404 {
		t.Fatalf("unavailable public audio status %d", r.Code)
	}
	r = call(t, h.AdminPlaybackURL, "POST", "/", nil, gin.Params{{Key: "id", Value: a.ID}})
	if r.Code != 200 {
		t.Fatalf("admin presign status %d: %s", r.Code, r.Body.String())
	}
}

func TestMigrationDownAndUp(t *testing.T) {
	db := testDB(t)
	sql, e := db.DB()
	must(t, e)
	must(t, goose.Down(sql, "migrations"))
	must(t, storage.Migrate(db))
}
func TestInvalidAudioNeverEntersLibrary(t *testing.T) {
	db := testDB(t)
	store, objects := fakeStore(t)
	p := filepath.Join(t.TempDir(), "invalid.wav")
	must(t, os.WriteFile(p, []byte("not an audio file"), 0600))
	if _, _, e := ingestAudioFile(context.Background(), db, store, p, "wav", ingestOptions{}); e == nil {
		t.Fatal("invalid audio accepted")
	}
	var n int64
	must(t, db.Model(&model.Track{}).Count(&n).Error)
	if n != 0 {
		t.Fatal("invalid track persisted")
	}
	objects.Range(func(_, _ any) bool { t.Error("invalid object uploaded"); return false })
}
