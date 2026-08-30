package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/akagiyui/oh-my-music-bank/internal/service/cache"
	pkgerrors "github.com/akagiyui/oh-my-music-bank/pkg/errors"
	"github.com/akagiyui/oh-my-music-bank/pkg/response"
)

// IntegrationsHandler 管理外部集成的密钥（哔哩哔哩 Cookie、讯飞凭据）。
type IntegrationsHandler struct {
	cache *cache.Manager
}

// NewIntegrationsHandler 创建集成配置处理器。
func NewIntegrationsHandler(c *cache.Manager) *IntegrationsHandler {
	return &IntegrationsHandler{cache: c}
}

// Get 返回集成配置状态（敏感值不回显，只回显是否已配置）。
func (h *IntegrationsHandler) Get(c *gin.Context) {
	response.Success(c, gin.H{
		"bilibiliCookieSet": h.cache.GetSetting("bilibili.cookie") != "",
		"xfyunAppId":        h.cache.GetSetting("xfyun.app_id"),
		"xfyunApiKeySet":    h.cache.GetSetting("xfyun.api_key") != "",
	})
}

// Update 更新集成配置（字段为 nil 表示不变；空字符串表示清空）。
func (h *IntegrationsHandler) Update(c *gin.Context) {
	var req struct {
		BilibiliCookie *string `json:"bilibiliCookie"`
		XfyunAppID     *string `json:"xfyunAppId"`
		XfyunAPIKey    *string `json:"xfyunApiKey"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, pkgerrors.BadRequest(err.Error()))
		return
	}
	set := func(key string, v *string) error {
		if v == nil {
			return nil
		}
		return h.cache.SetSetting(key, *v)
	}
	if err := set("bilibili.cookie", req.BilibiliCookie); err != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal("failed to save"))
		return
	}
	_ = set("xfyun.app_id", req.XfyunAppID)
	_ = set("xfyun.api_key", req.XfyunAPIKey)
	response.NoContent(c)
}
