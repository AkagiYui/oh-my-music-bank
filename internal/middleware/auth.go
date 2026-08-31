package middleware

import (
	"github.com/akagiyui/oh-my-music-bank/internal/config"
	"github.com/akagiyui/oh-my-music-bank/internal/model"
	"github.com/akagiyui/oh-my-music-bank/internal/service/session"
	pkgerrors "github.com/akagiyui/oh-my-music-bank/pkg/errors"
	"github.com/akagiyui/oh-my-music-bank/pkg/keys"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"net/http"
	"strings"
)

const (
	CtxUser     = "user"
	CtxUserID   = "user_id"
	CtxUserRole = "user_role"
	CtxAPIKeyID = "api_key_id"
)

func WebAuthMiddleware(cfg config.Auth, db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		raw := strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
		claims, err := session.Parse(cfg, raw, "access")
		if err != nil {
			c.AbortWithStatusJSON(401, pkgerrors.Unauthorized("invalid or expired access token"))
			return
		}
		u, err := session.User(db.WithContext(c.Request.Context()), claims)
		if err != nil {
			c.AbortWithStatusJSON(401, pkgerrors.Unauthorized("session revoked or user inactive"))
			return
		}
		c.Set(CtxUser, u)
		c.Set(CtxUserID, u.ID)
		c.Set(CtxUserRole, u.Role)
		c.Set("session_id", claims.SessionID)
		c.Next()
	}
}
func AdminOnly() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.GetString(CtxUserRole) != "admin" {
			c.AbortWithStatusJSON(403, pkgerrors.Forbidden("admin privilege required"))
			return
		}
		c.Next()
	}
}

// 媒体凭证仅绑定一个资源，且每次读取都会复查账号和会话/密钥状态。
func MediaTokenAuth(cfg config.Auth, db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		claims, err := session.Parse(cfg, c.Query("token"), "media")
		if err != nil || claims.Resource != c.Request.URL.Path+"?"+mediaQuery(c) {
			c.AbortWithStatusJSON(401, pkgerrors.Unauthorized("invalid media token"))
			return
		}
		u, err := session.User(db.WithContext(c.Request.Context()), claims)
		if err != nil {
			c.AbortWithStatusJSON(401, pkgerrors.Unauthorized("media access revoked"))
			return
		}
		if strings.Contains(c.Request.URL.Path, "bilibili") && u.Role != "admin" {
			c.AbortWithStatus(403)
			return
		}
		c.Set(CtxUserID, u.ID)
		c.Set(CtxUserRole, u.Role)
		c.Set(CtxAPIKeyID, claims.APIKeyID)
		c.Set("session_id", claims.SessionID)
		c.Header("Cache-Control", "private, no-store")
		c.Header("Referrer-Policy", "no-referrer")
		c.Next()
	}
}
func mediaQuery(c *gin.Context) string { q := c.Request.URL.Query(); q.Del("token"); return q.Encode() }
func APIKeyAuthMiddleware(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		plain := extractAPIKey(c)
		if !keys.HasValidPrefix(plain) {
			c.AbortWithStatusJSON(401, pkgerrors.Unauthorized("missing or invalid api key"))
			return
		}
		var k model.APIKey
		err := db.WithContext(c.Request.Context()).Where("key_hash = ? AND NOT is_revoked AND (expires_at IS NULL OR expires_at > now()) AND EXISTS (SELECT 1 FROM app_user u WHERE u.id = api_key.user_id AND u.is_active)", keys.Hash(plain)).First(&k).Error
		if err != nil {
			c.AbortWithStatusJSON(401, pkgerrors.Unauthorized("invalid, expired or disabled api key"))
			return
		}
		c.Set(CtxUserID, k.UserID)
		c.Set(CtxAPIKeyID, k.ID)
		rpm := 60
		if k.RPMOverride != nil && *k.RPMOverride > 0 {
			rpm = *k.RPMOverride
		}
		if !AllowRequest(c, db, "key:"+k.ID, rpm) {
			return
		}
		// 合并高频 last_used_at 更新，避免每次请求创建后台 goroutine。
		if err := db.WithContext(c.Request.Context()).Model(&k).Where("last_used_at IS NULL OR last_used_at < now() - interval '1 minute'").Update("last_used_at", gorm.Expr("now()")).Error; err != nil {
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, pkgerrors.Internal("failed to update key usage"))
			return
		}
		c.Next()
	}
}
func extractAPIKey(c *gin.Context) string {
	if a := c.GetHeader("Authorization"); strings.HasPrefix(a, "Bearer ") {
		return strings.TrimPrefix(a, "Bearer ")
	}
	return c.GetHeader("X-API-Key")
}
