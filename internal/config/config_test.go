package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
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
