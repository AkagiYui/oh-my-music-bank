package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestDatabaseOnlyConfig(t *testing.T) {
	t.Chdir(t.TempDir())
	// 配置测试不读取开发者的 .env，也不依赖机器上的真实凭据。
	for _, names := range envBindings {
		for _, name := range names {
			t.Setenv(name, "")
		}
	}
	path := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(path, []byte("database:\n  dsn: postgres://file/test\n"), 0600); err != nil {
		t.Fatal(err)
	}
	cfg, err := LoadDatabase(path)
	if err != nil || cfg.DSN != "postgres://file/test" || cfg.MaxOpenConns != defaultDatabaseMaxOpen {
		t.Fatalf("database-only config: %+v, %v", cfg, err)
	}
	if _, err := Load(path); err == nil || !strings.Contains(err.Error(), "jwt_secret") {
		t.Fatalf("server must still require JWT secret: %v", err)
	}
	t.Setenv("DB", "postgres://environment/test")
	cfg, err = LoadDatabase(path)
	if err != nil || cfg.DSN != "postgres://environment/test" {
		t.Fatalf("environment override: %+v, %v", cfg, err)
	}
	t.Setenv("OMMB_DATABASE_DSN", "postgres://structured/test")
	cfg, err = LoadDatabase(path)
	if err != nil || cfg.DSN != "postgres://structured/test" {
		t.Fatalf("structured environment priority: %+v, %v", cfg, err)
	}
	t.Setenv("DB", "")
	t.Setenv("OMMB_DATABASE_DSN", "")
	if _, err := LoadDatabase("missing.yaml"); err == nil {
		t.Fatal("missing database config accepted")
	}
}

func TestStorageValidationAndPublicURL(t *testing.T) {
	cfg := Storage{
		Public: PublicStorage{
			S3:      S3{Endpoint: "https://public.example.com", AccessKey: "pub", SecretKey: "pub-secret", Bucket: "covers"},
			BaseURL: "https://cdn.example.com/assets/",
		},
		Private: PrivateStorage{
			S3:              S3{Endpoint: "https://private.example.com", AccessKey: "priv", SecretKey: "priv-secret", Bucket: "media"},
			PresignedURLTTL: "30m",
		},
	}
	if err := validateStorage(cfg); err != nil {
		t.Fatal(err)
	}
	if got := cfg.Public.PublicURL("/cover/a.jpg"); got != "https://cdn.example.com/assets/cover/a.jpg" {
		t.Fatalf("public URL %q", got)
	}
	if got, err := cfg.Private.PresignedURLDuration(); err != nil || got != 30*time.Minute {
		t.Fatalf("presign ttl %s, %v", got, err)
	}
	if got := cfg.Public.EndpointHost(); got != "public.example.com" {
		t.Fatalf("endpoint host %q", got)
	}

	// 不同 endpoint 下允许桶名相同，同一 endpoint 下不允许。
	same := cfg
	same.Private.Bucket = same.Public.Bucket
	if err := validateStorage(same); err != nil {
		t.Fatalf("same bucket name on different endpoints rejected: %v", err)
	}
	same.Private.Endpoint = "public.example.com"
	if err := validateStorage(same); err == nil {
		t.Fatal("same physical bucket accepted")
	}

	// 两套凭据彼此独立：缺少任一桶的字段都应被拒绝，且错误指明是哪一套。
	missing := cfg
	missing.Private.SecretKey = ""
	if err := validateStorage(missing); err == nil || !strings.Contains(err.Error(), "storage.private.secret_key") {
		t.Fatalf("missing private secret: %v", err)
	}
	missing = cfg
	missing.Public.Endpoint = ""
	if err := validateStorage(missing); err == nil || !strings.Contains(err.Error(), "storage.public.endpoint") {
		t.Fatalf("missing public endpoint: %v", err)
	}
}

func TestStorageEnvBindingsAreSeparate(t *testing.T) {
	t.Chdir(t.TempDir())
	for _, names := range envBindings {
		for _, name := range names {
			t.Setenv(name, "")
		}
	}
	t.Setenv("S3_PUBLIC_ENDPOINT", "https://public.example.com")
	t.Setenv("S3_PUBLIC_ACCESS_KEY", "pub")
	t.Setenv("S3_PUBLIC_SECRET_KEY", "pub-secret")
	t.Setenv("S3_PUBLIC_BUCKET", "covers")
	t.Setenv("S3_PUBLIC_BASE_URL", "https://cdn.example.com")
	t.Setenv("OMMB_STORAGE_PRIVATE_ENDPOINT", "https://private.example.com")
	t.Setenv("OMMB_STORAGE_PRIVATE_ACCESS_KEY", "priv")
	t.Setenv("OMMB_STORAGE_PRIVATE_SECRET_KEY", "priv-secret")
	t.Setenv("OMMB_STORAGE_PRIVATE_BUCKET", "media")
	t.Setenv("DB", "postgres://environment/test")
	t.Setenv("JWT_SECRET", strings.Repeat("x", 32))
	cfg, err := Load("missing.yaml")
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Storage.Public.AccessKey != "pub" || cfg.Storage.Private.AccessKey != "priv" {
		t.Fatalf("credentials leaked across buckets: %+v", cfg.Storage)
	}
	if cfg.Storage.Private.PresignedURLTTL != "30m" {
		t.Fatalf("default presign ttl %q", cfg.Storage.Private.PresignedURLTTL)
	}
}
