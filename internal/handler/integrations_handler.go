package handler

import (
	"github.com/akagiyui/oh-my-music-bank/internal/service/bilibili"
	"github.com/akagiyui/oh-my-music-bank/internal/service/recognize"
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
	values := map[string]string{}
	if req.BilibiliCookie != nil {
		values["bilibili.cookie"] = *req.BilibiliCookie
	}
	if req.XfyunAppID != nil {
		values["xfyun.app_id"] = *req.XfyunAppID
	}
	if req.XfyunAPIKey != nil {
		values["xfyun.api_key"] = *req.XfyunAPIKey
	}
	if err := h.cache.SetSettings(values); err != nil {
		c.JSON(500, pkgerrors.Internal("保存失败"))
		return
	}
	response.NoContent(c)
}

func (h *IntegrationsHandler) Test(c *gin.Context) {
	var req struct {
		Provider string `json:"provider"`
	}
	if c.ShouldBindJSON(&req) != nil {
		c.JSON(400, pkgerrors.BadRequest("invalid request"))
		return
	}
	if req.Provider == "bilibili" {
		_, err := bilibili.New().SelfMID(c.Request.Context(), h.cache.GetSetting("bilibili.cookie"))
		if err != nil {
			c.JSON(502, pkgerrors.BadRequest("连接或认证失败: "+err.Error()))
			return
		}
		response.Success(c, gin.H{"message": "B 站连接与认证正常"})
		return
	}
	if req.Provider == "xfyun" {
		_, err := recognize.Xfyun(c.Request.Context(), recognize.XfyunCreds{AppID: h.cache.GetSetting("xfyun.app_id"), APIKey: h.cache.GetSetting("xfyun.api_key")}, make([]byte, 32000))
		if err != nil {
			c.JSON(502, pkgerrors.BadRequest("测试请求未通过: "+err.Error()))
			return
		}
		response.Success(c, gin.H{"message": "讯飞测试请求成功（静音样本）"})
		return
	}
	c.JSON(400, pkgerrors.BadRequest("unknown provider"))
}
