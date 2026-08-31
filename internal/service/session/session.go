package session

import (
	"errors"
	"time"

	"github.com/akagiyui/oh-my-music-bank/internal/config"
	"github.com/akagiyui/oh-my-music-bank/internal/model"
	"github.com/akagiyui/oh-my-music-bank/pkg/keys"
	jwt "github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type Claims struct {
	UserID    string `json:"user_id"`
	Kind      string `json:"kind"`
	SessionID string `json:"sid,omitempty"`
	APIKeyID  string `json:"api_key_id,omitempty"`
	Resource  string `json:"resource,omitempty"`
	jwt.RegisteredClaims
}

func Sign(cfg config.Auth, c Claims, ttl time.Duration) (string, error) {
	if len(cfg.JWTSecret) < 32 || ttl <= 0 {
		return "", errors.New("无效的 JWT 密钥或有效期")
	}
	c.RegisteredClaims = jwt.RegisteredClaims{Issuer: "ommb", ID: uuid.NewString(), IssuedAt: jwt.NewNumericDate(time.Now()), ExpiresAt: jwt.NewNumericDate(time.Now().Add(ttl))}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, c).SignedString([]byte(cfg.JWTSecret))
}
func Parse(cfg config.Auth, raw, kind string) (*Claims, error) {
	c := &Claims{}
	t, err := jwt.ParseWithClaims(raw, c, func(*jwt.Token) (any, error) { return []byte(cfg.JWTSecret), nil }, jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuer("ommb"), jwt.WithExpirationRequired())
	if err != nil || !t.Valid || c.Kind != kind || c.UserID == "" {
		return nil, errors.New("无效或已过期的令牌")
	}
	return c, nil
}

// 用户行锁与改密共用，避免校验旧密码后创建新会话的竞态。
func New(db *gorm.DB, cfg config.Auth, u *model.User) (string, string, error) {
	var access, refresh string
	err := db.Transaction(func(tx *gorm.DB) error {
		var current model.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND is_active = true", u.ID).First(&current).Error; err != nil {
			return err
		}
		if current.PasswordHash != u.PasswordHash {
			return errors.New("账号已变更，请重新登录")
		}
		s := model.AuthSession{ID: uuid.NewString(), UserID: u.ID}
		var err error
		access, refresh, err = rotate(tx, cfg, &s, true)
		return err
	})
	return access, refresh, err
}
func rotate(tx *gorm.DB, cfg config.Auth, s *model.AuthSession, create bool) (string, string, error) {
	at, err := cfg.AccessTokenDuration()
	if err != nil {
		return "", "", err
	}
	rt, err := cfg.RefreshTokenDuration()
	if err != nil {
		return "", "", err
	}
	// 刷新不会无限延长会话的绝对寿命。
	if create {
		s.ExpiresAt = time.Now().Add(rt)
	} else {
		rt = time.Until(s.ExpiresAt)
	}
	if rt <= 0 {
		return "", "", errors.New("会话已过期")
	}
	if at > rt {
		at = rt
	}
	access, err := Sign(cfg, Claims{UserID: s.UserID, Kind: "access", SessionID: s.ID}, at)
	if err != nil {
		return "", "", err
	}
	refresh, err := Sign(cfg, Claims{UserID: s.UserID, Kind: "refresh", SessionID: s.ID}, rt)
	if err != nil {
		return "", "", err
	}
	s.RefreshHash = keys.Hash(refresh)
	if create {
		err = tx.Create(s).Error
	} else {
		err = tx.Model(s).Update("refresh_hash", s.RefreshHash).Error
	}
	return access, refresh, err
}
func Refresh(db *gorm.DB, cfg config.Auth, raw string) (string, string, error) {
	c, err := Parse(cfg, raw, "refresh")
	if err != nil {
		return "", "", err
	}
	var access, refresh string
	err = db.Transaction(func(tx *gorm.DB) error {
		var user model.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND is_active = true", c.UserID).First(&user).Error; err != nil {
			return err
		}
		var s model.AuthSession
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND user_id = ? AND expires_at > now()", c.SessionID, c.UserID).First(&s).Error; err != nil {
			return err
		}
		if s.RefreshHash != keys.Hash(raw) {
			return errors.New("刷新令牌已使用或撤销")
		}
		var e error
		access, refresh, e = rotate(tx, cfg, &s, false)
		return e
	})
	return access, refresh, err
}
func User(db *gorm.DB, c *Claims) (*model.User, error) {
	var u model.User
	q := db.Where("id = ? AND is_active = true", c.UserID)
	if c.SessionID != "" {
		q = q.Where("EXISTS (SELECT 1 FROM auth_session s WHERE s.id = ? AND s.user_id = app_user.id AND s.expires_at > now())", c.SessionID)
	} else if c.APIKeyID != "" {
		q = q.Where("EXISTS (SELECT 1 FROM api_key k WHERE k.id = ? AND k.user_id = app_user.id AND NOT k.is_revoked AND (k.expires_at IS NULL OR k.expires_at > now()))", c.APIKeyID)
	} else {
		return nil, errors.New("缺少会话")
	}
	err := q.First(&u).Error
	return &u, err
}
