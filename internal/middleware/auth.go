// Package middleware 提供认证与日志中间件。
package middleware

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	jwt "github.com/golang-jwt/jwt/v5"
	"gorm.io/gorm"

	"github.com/akagiyui/oh-my-music-bank/internal/config"
	"github.com/akagiyui/oh-my-music-bank/internal/model"
	pkgerrors "github.com/akagiyui/oh-my-music-bank/pkg/errors"
	"github.com/akagiyui/oh-my-music-bank/pkg/keys"
)

// 上下文键。
const (
	CtxUser     = "user"
	CtxUserID   = "user_id"
	CtxUserRole = "user_role"
	CtxAPIKeyID = "api_key_id"
)

// WebAuthMiddleware 解析 Bearer JWT 并从数据库加载最新用户信息。
func WebAuthMiddleware(cfg config.Auth, db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, pkgerrors.Unauthorized("missing or invalid authorization header"))
			return
		}

		token, err := jwt.Parse(parts[1], func(t *jwt.Token) (any, error) {
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, jwt.ErrSignatureInvalid
			}
			return []byte(cfg.JWTSecret), nil
		})
		if err != nil || !token.Valid {
			c.AbortWithStatusJSON(http.StatusUnauthorized, pkgerrors.Unauthorized("invalid or expired token"))
			return
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, pkgerrors.Unauthorized("invalid token claims"))
			return
		}
		userID, _ := claims["user_id"].(string)
		if userID == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, pkgerrors.Unauthorized("missing user_id claim"))
			return
		}

		var user model.User
		if err := db.Where("id = ? AND is_active = true", userID).First(&user).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				c.AbortWithStatusJSON(http.StatusUnauthorized, pkgerrors.Unauthorized("user not found or inactive"))
				return
			}
			c.AbortWithStatusJSON(http.StatusInternalServerError, pkgerrors.Internal("failed to query user"))
			return
		}

		c.Set(CtxUser, &user)
		c.Set(CtxUserID, user.ID)
		c.Set(CtxUserRole, user.Role)
		c.Next()
	}
}

// AdminOnly 要求当前用户为管理员。须在 WebAuthMiddleware 之后使用。
func AdminOnly() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.GetString(CtxUserRole) != "admin" {
			c.AbortWithStatusJSON(http.StatusForbidden, pkgerrors.Forbidden("admin privilege required"))
			return
		}
		c.Next()
	}
}

// MediaTokenAuth 用于媒体流端点：媒体元素无法设置 Authorization 头，
// 故从 query 参数 token 读取并校验 JWT，并要求管理员权限。
func MediaTokenAuth(cfg config.Auth, db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		tokenStr := c.Query("token")
		if tokenStr == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, pkgerrors.Unauthorized("missing token"))
			return
		}
		token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (any, error) {
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, jwt.ErrSignatureInvalid
			}
			return []byte(cfg.JWTSecret), nil
		})
		if err != nil || !token.Valid {
			c.AbortWithStatusJSON(http.StatusUnauthorized, pkgerrors.Unauthorized("invalid token"))
			return
		}
		claims, _ := token.Claims.(jwt.MapClaims)
		userID, _ := claims["user_id"].(string)
		if userID == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, pkgerrors.Unauthorized("invalid token"))
			return
		}
		var user model.User
		if err := db.Where("id = ? AND is_active = true", userID).First(&user).Error; err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, pkgerrors.Unauthorized("user not found"))
			return
		}
		if user.Role != "admin" {
			c.AbortWithStatusJSON(http.StatusForbidden, pkgerrors.Forbidden("admin privilege required"))
			return
		}
		c.Set(CtxUserID, user.ID)
		c.Set(CtxUserRole, user.Role)
		c.Next()
	}
}

// APIKeyAuthMiddleware 校验开放接口的 API 密钥（Authorization: Bearer / X-API-Key）。
func APIKeyAuthMiddleware(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		plain := extractAPIKey(c)
		if plain == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, pkgerrors.Unauthorized("missing api key"))
			return
		}
		if !keys.HasValidPrefix(plain) {
			c.AbortWithStatusJSON(http.StatusUnauthorized, pkgerrors.Unauthorized("invalid api key format"))
			return
		}

		var apiKey model.APIKey
		if err := db.Where("key_hash = ?", keys.Hash(plain)).First(&apiKey).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				c.AbortWithStatusJSON(http.StatusUnauthorized, pkgerrors.Unauthorized("invalid api key"))
				return
			}
			c.AbortWithStatusJSON(http.StatusInternalServerError, pkgerrors.Internal("failed to validate api key"))
			return
		}
		if apiKey.IsRevoked {
			c.AbortWithStatusJSON(http.StatusUnauthorized, pkgerrors.Unauthorized("api key has been revoked"))
			return
		}
		if apiKey.ExpiresAt != nil && time.Now().After(*apiKey.ExpiresAt) {
			c.AbortWithStatusJSON(http.StatusUnauthorized, pkgerrors.Unauthorized("api key has expired"))
			return
		}

		c.Set(CtxUserID, apiKey.UserID)
		c.Set(CtxAPIKeyID, apiKey.ID)

		// 异步更新最后使用时间，不阻塞请求。
		go func(id string) {
			db.Model(&model.APIKey{}).Where("id = ?", id).Update("last_used_at", time.Now())
		}(apiKey.ID)

		c.Next()
	}
}

// extractAPIKey 从 Authorization: Bearer 或 X-API-Key 头中提取密钥。
func extractAPIKey(c *gin.Context) string {
	if auth := c.GetHeader("Authorization"); auth != "" {
		parts := strings.SplitN(auth, " ", 2)
		if len(parts) == 2 && parts[0] == "Bearer" {
			return parts[1]
		}
	}
	if k := c.GetHeader("X-API-Key"); k != "" {
		return k
	}
	return ""
}
