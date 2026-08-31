package middleware

import (
	"context"
	"github.com/akagiyui/oh-my-music-bank/internal/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"log"
	"strconv"
	"time"
)

func APILogMiddleware(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		e := model.APIRequestLog{Path: c.FullPath(), StatusCode: c.Writer.Status(), LatencyMs: int(time.Since(start).Milliseconds()), ClientIP: c.ClientIP()}
		if v := c.GetString(CtxAPIKeyID); v != "" {
			e.APIKeyID = &v
		}
		if v := c.GetString(CtxUserID); v != "" {
			e.UserID = &v
		}
		if v, err := strconv.ParseInt(c.Param("id"), 10, 64); err == nil {
			e.TrackID = &v
		}
		// 有界同步审计覆盖鉴权失败；客户端断开后也允许短时间完成写入。
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		if err := db.WithContext(ctx).Create(&e).Error; err != nil {
			log.Printf("audit persistence failed path=%s status=%d: %v", e.Path, e.StatusCode, err)
		}
	}
}
