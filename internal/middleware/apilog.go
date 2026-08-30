package middleware

import (
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/akagiyui/oh-my-music-bank/internal/model"
)

// APILogMiddleware 在开放接口处理完成后，异步记录一条调用日志（审计与用量统计）。
func APILogMiddleware(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()

		entry := model.APIRequestLog{
			Path:       c.FullPath(),
			StatusCode: c.Writer.Status(),
			LatencyMs:  int(time.Since(start).Milliseconds()),
			ClientIP:   c.ClientIP(),
		}
		if v := c.GetString(CtxAPIKeyID); v != "" {
			entry.APIKeyID = &v
		}
		if v := c.GetString(CtxUserID); v != "" {
			entry.UserID = &v
		}

		go func(e model.APIRequestLog) {
			db.Create(&e)
		}(entry)
	}
}
