package handler

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/akagiyui/oh-my-music-bank/internal/model"
	"github.com/akagiyui/oh-my-music-bank/internal/service/cache"
	"github.com/akagiyui/oh-my-music-bank/internal/service/site"
	pkgerrors "github.com/akagiyui/oh-my-music-bank/pkg/errors"
	"github.com/akagiyui/oh-my-music-bank/pkg/response"
)

type SiteHandler struct {
	db    *gorm.DB
	cache *cache.Manager
}

func NewSiteHandler(db *gorm.DB, c *cache.Manager) *SiteHandler {
	return &SiteHandler{db: db, cache: c}
}

// 单次读取数据库快照，避免多实例缓存刷新延迟或逐字段读取混入不同版本。
func (h *SiteHandler) settings(c *gin.Context) (site.Settings, error) {
	keys := make([]string, 0)
	for key := range (site.Settings{}).Values() {
		keys = append(keys, key)
	}
	var rows []model.Setting
	err := h.db.WithContext(c.Request.Context()).Where("key IN ?", keys).Find(&rows).Error
	values := make(map[string]string, len(rows))
	for _, row := range rows {
		values[row.Key] = row.Value
	}
	return site.FromValues(values), err
}

func (h *SiteHandler) PublicConfig(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	settings, err := h.settings(c)
	if err != nil {
		c.JSON(500, pkgerrors.Internal("读取站点配置失败"))
		return
	}
	// 只公开显式 DTO，不暴露日志策略或未来加入的管理配置。
	response.Success(c, settings.Config)
}

func (h *SiteHandler) AdminGetSettings(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	settings, err := h.settings(c)
	if err != nil {
		c.JSON(500, pkgerrors.Internal("读取站点配置失败"))
		return
	}
	response.Success(c, settings)
}

// AdminUpdateSettings 以完整 PUT 替换配置；不接受旧字段和未知字段。
func (h *SiteHandler) AdminUpdateSettings(c *gin.Context) {
	var settings site.Settings
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(400, pkgerrors.BadRequest("无法读取配置请求"))
		return
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&settings); err != nil {
		c.JSON(http.StatusBadRequest, pkgerrors.BadRequest("配置格式错误："+err.Error()))
		return
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		c.JSON(400, pkgerrors.BadRequest("请求只能包含一个 JSON 对象"))
		return
	}
	// 完整 PUT 必须包含每个字段；缺失或 null 不能悄悄清空品牌、关闭注册或改变日志策略。
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(body, &fields); err != nil {
		c.JSON(400, pkgerrors.BadRequest("配置必须为 JSON 对象"))
		return
	}
	for _, key := range []string{"systemTitle", "siteDescription", "homeTitle", "homeDescription", "logoUrl", "faviconUrl", "footerText", "footerLinkUrl", "apiOrigin", "registrationEnabled", "logRetentionDays"} {
		if value, ok := fields[key]; !ok || bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			c.JSON(400, pkgerrors.BadRequest("完整配置缺少字段："+key))
			return
		}
	}
	if err := settings.Normalize(); err != nil {
		c.JSON(400, pkgerrors.BadRequest(err.Error()))
		return
	}
	if err := h.cache.SetSettings(settings.Values()); err != nil {
		c.JSON(500, pkgerrors.Internal("保存站点配置失败"))
		return
	}
	c.Header("Cache-Control", "no-store")
	response.Success(c, settings)
}
