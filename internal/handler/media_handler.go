package handler

import (
	"fmt"
	"github.com/akagiyui/oh-my-music-bank/internal/config"
	"github.com/akagiyui/oh-my-music-bank/internal/middleware"
	"github.com/akagiyui/oh-my-music-bank/internal/model"
	"github.com/akagiyui/oh-my-music-bank/internal/service/session"
	"github.com/akagiyui/oh-my-music-bank/internal/storage/objectstore"
	pkgerrors "github.com/akagiyui/oh-my-music-bank/pkg/errors"
	"github.com/akagiyui/oh-my-music-bank/pkg/response"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"net/http"
	"net/url"
	"path"
	"time"
)

func mediaURL(c *gin.Context, resource string) string {
	cfg, ok := c.Get("media_auth")
	if !ok {
		return ""
	}
	u, err := url.Parse(resource)
	if err != nil {
		return ""
	}
	claims := session.Claims{UserID: c.GetString(middleware.CtxUserID), Kind: "media", SessionID: c.GetString("session_id"), APIKeyID: c.GetString(middleware.CtxAPIKeyID), Resource: u.Path + "?" + u.Query().Encode()}
	token, err := session.Sign(cfg.(config.Auth), claims, 30*time.Minute)
	if err != nil {
		return ""
	}
	q := u.Query()
	q.Set("token", token)
	u.RawQuery = q.Encode()
	return u.String()
}
func BiliMediaToken(c *gin.Context) {
	var r struct {
		Bvid string `json:"bvid"`
		CID  int64  `json:"cid"`
	}
	if c.ShouldBindJSON(&r) != nil || r.Bvid == "" || r.CID <= 0 {
		c.JSON(400, pkgerrors.BadRequest("bvid/cid required"))
		return
	}
	response.Success(c, gin.H{"url": mediaURL(c, fmt.Sprintf("/api/v1/admin/bilibili/stream?bvid=%s&cid=%d", url.QueryEscape(r.Bvid), r.CID))})
}
func ServeMedia(db *gorm.DB, store *objectstore.Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := parseInt64Param(c, "id")
		if !ok {
			return
		}
		key := ""
		trackID := int64(0)
		switch c.Param("kind") {
		case "audio":
			var a model.Audio
			if db.First(&a, id).Error != nil {
				c.Status(404)
				return
			}
			key = a.FileKey
			trackID = a.TrackID
		case "origin":
			if c.GetString(middleware.CtxUserRole) != "admin" {
				c.Status(403)
				return
			}
			var a model.OriginAudio
			if db.First(&a, id).Error != nil {
				c.Status(404)
				return
			}
			key = a.FileKey
			trackID = a.TrackID
		default:
			c.Status(404)
			return
		}
		var t model.Track
		if db.First(&t, trackID).Error != nil || (!t.Available && c.GetString(middleware.CtxUserRole) != "admin") {
			c.Status(404)
			return
		}
		object, err := store.Open(c.Request.Context(), key)
		if err != nil {
			c.Status(502)
			return
		}
		defer object.Close()
		stat, err := object.Stat()
		if err != nil {
			c.Status(404)
			return
		}
		c.Header("Content-Type", stat.ContentType)
		c.Header("X-Content-Type-Options", "nosniff")
		// 由服务端处理 Range，每次新请求都会重新检查撤销状态。
		http.ServeContent(c.Writer, c.Request, path.Base(key), stat.LastModified, object)
	}
}
