package main

import (
	"bytes"
	"context"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/akagiyui/oh-my-music-bank/internal/config"
	"github.com/akagiyui/oh-my-music-bank/internal/model"
	"github.com/akagiyui/oh-my-music-bank/internal/service/session"
	storage "github.com/akagiyui/oh-my-music-bank/internal/storage/db"
	"github.com/akagiyui/oh-my-music-bank/pkg/keys"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

// 测试仅使用显式配置的 PostgreSQL，并为每次运行创建独立数据库。
func resetTestDB(t *testing.T) (*gorm.DB, string) {
	t.Helper()
	dsn := os.Getenv("OMMB_TEST_DSN")
	if dsn == "" {
		t.Skip("set OMMB_TEST_DSN to run isolated PostgreSQL regression tests")
	}
	u, err := url.Parse(dsn)
	if err != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") {
		t.Fatal("OMMB_TEST_DSN must be a PostgreSQL URL")
	}
	root, err := storage.Init(dsn, 2, 1, 60, 60)
	check(t, err)
	rootSQL, err := root.DB()
	check(t, err)
	t.Cleanup(func() { rootSQL.Close() })
	name := "ommb_cli_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	check(t, root.Exec("CREATE DATABASE "+name).Error)
	t.Cleanup(func() { root.Exec("DROP DATABASE " + name + " WITH (FORCE)") })
	u.Path = "/" + name
	db, err := storage.Init(u.String(), 10, 2, 60, 60)
	check(t, err)
	sqlDB, err := db.DB()
	check(t, err)
	t.Cleanup(func() { sqlDB.Close() })
	check(t, storage.Migrate(db))
	return db, u.String()
}

func check(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

func resetTestUser(t *testing.T, db *gorm.DB) model.User {
	t.Helper()
	hash, err := bcrypt.GenerateFromPassword([]byte("old-password"), bcrypt.MinCost)
	check(t, err)
	u := model.User{Username: uuid.NewString(), Email: uuid.NewString() + "@example.com", PasswordHash: string(hash), Role: "admin", IsActive: true}
	check(t, db.Create(&u).Error)
	return u
}

func TestResetPasswordPostgres(t *testing.T) {
	db, dsn := resetTestDB(t)
	cfg := config.Auth{JWTSecret: strings.Repeat("t", 32), AccessTokenTTL: "15m", RefreshTokenTTL: "24h"}
	t.Run("CLI resets only target and revokes sessions", func(t *testing.T) {
		u := resetTestUser(t, db)
		other := resetTestUser(t, db)
		access, refresh, err := session.New(db, cfg, &u)
		check(t, err)
		_, _, err = session.New(db, cfg, &u)
		check(t, err)
		otherAccess, _, err := session.New(db, cfg, &other)
		check(t, err)
		key := model.APIKey{UserID: u.ID, KeyHash: keys.Hash(uuid.NewString()), KeyPrefix: "omb_test"}
		check(t, db.Create(&key).Error)
		t.Setenv("OMMB_DATABASE_DSN", dsn)
		var output bytes.Buffer
		const password = " new-password "
		check(t, run([]string{"reset-password", "--email", u.Email, "--password-stdin"}, passwordInput(t, password+"\r\n"), &output, &output))
		if !strings.Contains(output.String(), u.Email) || strings.Contains(output.String(), password) {
			t.Fatal("CLI output missing target or leaking password")
		}
		var current model.User
		check(t, db.First(&current, "id = ?", u.ID).Error)
		check(t, bcrypt.CompareHashAndPassword([]byte(current.PasswordHash), []byte(password)))
		cost, err := bcrypt.Cost([]byte(current.PasswordHash))
		check(t, err)
		if cost != 12 || bcrypt.CompareHashAndPassword([]byte(current.PasswordHash), []byte("old-password")) == nil {
			t.Fatal("hash cost incorrect or old password still works")
		}
		if current.Role != u.Role || current.IsActive != u.IsActive || current.Username != u.Username || current.Email != u.Email {
			t.Fatal("reset changed unrelated user fields")
		}
		var count int64
		check(t, db.Model(&model.AuthSession{}).Where("user_id = ?", u.ID).Count(&count).Error)
		if count != 0 {
			t.Fatal("target sessions remain")
		}
		claims, err := session.Parse(cfg, access, "access")
		check(t, err)
		if _, err := session.User(db, claims); err == nil {
			t.Fatal("old access token still works")
		}
		if _, _, err := session.Refresh(db, cfg, refresh); err == nil {
			t.Fatal("old refresh token still works")
		}
		// 模拟旧密码已验证、但在重置完成后才尝试创建会话的并发登录。
		if _, _, err := session.New(db, cfg, &u); err == nil {
			t.Fatal("stale login created a session after reset")
		}
		_, _, err = session.New(db, cfg, &current)
		check(t, err)
		var currentKey model.APIKey
		check(t, db.First(&currentKey, "id = ?", key.ID).Error)
		if currentKey.KeyHash != key.KeyHash || currentKey.IsRevoked {
			t.Fatal("API key changed")
		}
		claims, err = session.Parse(cfg, otherAccess, "access")
		check(t, err)
		currentOther, err := session.User(db, claims)
		check(t, err)
		if currentOther.PasswordHash != other.PasswordHash {
			t.Fatal("other user's password changed")
		}
	})

	t.Run("unknown email does not create user", func(t *testing.T) {
		var before, after int64
		check(t, db.Model(&model.User{}).Count(&before).Error)
		if _, err := resetPassword(context.Background(), db, "absent@example.com", []byte("new-password")); err == nil {
			t.Fatal("unknown user accepted")
		}
		check(t, db.Model(&model.User{}).Count(&after).Error)
		if before != after {
			t.Fatal("reset created a user")
		}
	})

	t.Run("disabled account remains disabled", func(t *testing.T) {
		u := resetTestUser(t, db)
		check(t, db.Model(&u).Update("is_active", false).Error)
		t.Setenv("OMMB_DATABASE_DSN", dsn)
		var output bytes.Buffer
		check(t, run([]string{"reset-password", "--email", u.Email, "--password-stdin"}, passwordInput(t, "new-password"), &output, &output))
		check(t, db.First(&u, "id = ?", u.ID).Error)
		if u.IsActive || !strings.Contains(output.String(), "禁用") {
			t.Fatal("disabled account enabled or missing warning")
		}
		check(t, bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte("new-password")))
	})

	t.Run("session deletion failure rolls password back", func(t *testing.T) {
		u := resetTestUser(t, db)
		access, _, err := session.New(db, cfg, &u)
		check(t, err)
		claims, err := session.Parse(cfg, access, "access")
		check(t, err)
		// 用外键阻止会话删除，验证密码 UPDATE 不会在失败事务中残留。
		check(t, db.Exec("CREATE TABLE reset_session_guard (session_id uuid REFERENCES auth_session(id))").Error)
		defer db.Exec("DROP TABLE reset_session_guard")
		check(t, db.Exec("INSERT INTO reset_session_guard VALUES (?)", claims.SessionID).Error)
		if _, err := resetPassword(context.Background(), db, u.Email, []byte("new-password")); err == nil {
			t.Fatal("reset succeeded despite failed session deletion")
		}
		current, err := session.User(db, claims)
		check(t, err)
		if current.PasswordHash != u.PasswordHash {
			t.Fatal("password update was not rolled back")
		}
	})
}
