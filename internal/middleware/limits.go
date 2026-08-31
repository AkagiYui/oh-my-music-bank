package middleware

import (
	"context"
	pkgerrors "github.com/akagiyui/oh-my-music-bank/pkg/errors"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"net/http"
	"strconv"
	"time"
)

// 在 PostgreSQL 原子计数，使多实例共享限额。后台定期清理过期桶。
func AllowRequest(c *gin.Context, db *gorm.DB, bucket string, limit int) bool {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 3*time.Second)
	defer cancel()
	var used int
	err := db.WithContext(ctx).Raw(`INSERT INTO request_budget(bucket,window_start,used) VALUES (?,date_trunc('minute',now()),1)
 ON CONFLICT(bucket) DO UPDATE SET window_start=date_trunc('minute',now()), used=CASE WHEN request_budget.window_start=date_trunc('minute',now()) THEN request_budget.used+1 ELSE 1 END RETURNING used`, bucket).Scan(&used).Error
	if err != nil {
		c.AbortWithStatusJSON(503, pkgerrors.Internal("rate limit unavailable"))
		return false
	}
	if used > limit {
		c.Header("Retry-After", strconv.Itoa(60-time.Now().Second()))
		c.AbortWithStatusJSON(429, pkgerrors.TooManyRequests("请求过于频繁，请稍后重试"))
		return false
	}
	return true
}
func IPRateLimit(db *gorm.DB, prefix string, limit int) gin.HandlerFunc {
	return func(c *gin.Context) {
		if AllowRequest(c, db, prefix+c.ClientIP(), limit) {
			c.Next()
		}
	}
}
func BodyLimit(maxBytes int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.ContentLength > maxBytes {
			c.AbortWithStatusJSON(413, pkgerrors.BadRequest("request body too large"))
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBytes)
		c.Next()
	}
}
