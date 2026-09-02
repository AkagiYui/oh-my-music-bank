package handler

import (
	"fmt"
	"net/url"
	"time"

	"github.com/akagiyui/oh-my-music-bank/internal/config"
	"github.com/akagiyui/oh-my-music-bank/internal/middleware"
	"github.com/akagiyui/oh-my-music-bank/internal/service/session"
	pkgerrors "github.com/akagiyui/oh-my-music-bank/pkg/errors"
	"github.com/akagiyui/oh-my-music-bank/pkg/response"
	"github.com/gin-gonic/gin"
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
func (h *BilibiliHandler) MediaToken(c *gin.Context) {
	var r struct {
		AccountID string `json:"accountId"`
		Bvid      string `json:"bvid"`
		CID       int64  `json:"cid"`
	}
	if c.ShouldBindJSON(&r) != nil || r.Bvid == "" || r.CID <= 0 {
		c.JSON(400, pkgerrors.BadRequest("bvid/cid required"))
		return
	}
	a, err := h.accounts.Get(c.Request.Context(), r.AccountID)
	if err != nil {
		accountError(c, err)
		return
	}
	// 账号 ID 是媒体签名资源的一部分，不能替换查询参数借用其他账号。
	response.Success(c, gin.H{"url": mediaURL(c, fmt.Sprintf("/api/v1/admin/bilibili/stream?accountId=%s&bvid=%s&cid=%d", url.QueryEscape(a.ID), url.QueryEscape(r.Bvid), r.CID))})
}
