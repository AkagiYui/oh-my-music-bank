package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/akagiyui/oh-my-music-bank/internal/service/cache"
	pkgerrors "github.com/akagiyui/oh-my-music-bank/pkg/errors"
	"github.com/akagiyui/oh-my-music-bank/pkg/response"
)

// SiteHandler 处理站点设置（公开配置 + 管理员设置）。
type SiteHandler struct {
	db    *gorm.DB
	cache *cache.Manager
}

// NewSiteHandler 创建站点处理器。
func NewSiteHandler(db *gorm.DB, c *cache.Manager) *SiteHandler {
	return &SiteHandler{db: db, cache: c}
}

// PublicConfig 返回前端启动所需的公开配置。
func (h *SiteHandler) PublicConfig(c *gin.Context) {
	response.Success(c, gin.H{
		"brandName":           h.cache.GetSettingDefault("site.brand_name", "Oh My Music Bank"),
		"registrationEnabled": h.cache.GetSettingDefault("site.registration_enabled", "true") == "true",
	})
}

// AdminGetSettings 返回管理员可编辑的设置。
func (h *SiteHandler) AdminGetSettings(c *gin.Context) {
	response.Success(c, gin.H{
		"brandName":           h.cache.GetSettingDefault("site.brand_name", "Oh My Music Bank"),
		"registrationEnabled": h.cache.GetSettingDefault("site.registration_enabled", "true") == "true",
	})
}

// AdminUpdateSettings 更新站点设置。
func (h *SiteHandler) AdminUpdateSettings(c *gin.Context) {
	var req struct {
		BrandName           *string `json:"brandName"`
		RegistrationEnabled *bool   `json:"registrationEnabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, pkgerrors.BadRequest(err.Error()))
		return
	}
	if req.BrandName != nil {
		if err := h.cache.SetSetting("site.brand_name", *req.BrandName); err != nil {
			c.JSON(http.StatusInternalServerError, pkgerrors.Internal("failed to update setting"))
			return
		}
	}
	if req.RegistrationEnabled != nil {
		val := "false"
		if *req.RegistrationEnabled {
			val = "true"
		}
		if err := h.cache.SetSetting("site.registration_enabled", val); err != nil {
			c.JSON(http.StatusInternalServerError, pkgerrors.Internal("failed to update setting"))
			return
		}
	}
	response.NoContent(c)
}
