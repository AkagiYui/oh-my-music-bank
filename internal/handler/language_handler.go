package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/akagiyui/oh-my-music-bank/internal/model"
	pkgerrors "github.com/akagiyui/oh-my-music-bank/pkg/errors"
	"github.com/akagiyui/oh-my-music-bank/pkg/response"
)

// LanguageHandler 处理语种管理。
type LanguageHandler struct {
	db *gorm.DB
}

// NewLanguageHandler 创建语种处理器。
func NewLanguageHandler(db *gorm.DB) *LanguageHandler {
	return &LanguageHandler{db: db}
}

// List 列出全部语种（数量少，不分页）。
func (h *LanguageHandler) List(c *gin.Context) {
	var languages []model.Language
	if err := h.db.Order("id ASC").Find(&languages).Error; err != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal("failed to list languages"))
		return
	}
	response.Success(c, languages)
}

// Create 新建语种。
func (h *LanguageHandler) Create(c *gin.Context) {
	var req struct {
		Name string `json:"name" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, pkgerrors.BadRequest(err.Error()))
		return
	}
	lang := model.Language{Name: req.Name}
	if err := h.db.Create(&lang).Error; err != nil {
		c.JSON(http.StatusConflict, pkgerrors.Conflict("language already exists"))
		return
	}
	response.Created(c, lang)
}

// Delete 删除语种（级联解除曲目关联）。
func (h *LanguageHandler) Delete(c *gin.Context) {
	if err := h.db.Where("id = ?", c.Param("id")).Delete(&model.Language{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal("failed to delete language"))
		return
	}
	response.NoContent(c)
}
