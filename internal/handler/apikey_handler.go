package handler

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/akagiyui/oh-my-music-bank/internal/middleware"
	"github.com/akagiyui/oh-my-music-bank/internal/model"
	pkgerrors "github.com/akagiyui/oh-my-music-bank/pkg/errors"
	"github.com/akagiyui/oh-my-music-bank/pkg/keys"
	"github.com/akagiyui/oh-my-music-bank/pkg/response"
)

// APIKeyHandler 处理用户自助的 API 密钥管理。
type APIKeyHandler struct {
	db *gorm.DB
}

// NewAPIKeyHandler 创建 API 密钥处理器。
func NewAPIKeyHandler(db *gorm.DB) *APIKeyHandler {
	return &APIKeyHandler{db: db}
}

// List 列出当前用户的 API 密钥。
func (h *APIKeyHandler) List(c *gin.Context) {
	userID := c.GetString(middleware.CtxUserID)
	page, pageSize, offset := parsePagination(c)

	query := h.db.Model(&model.APIKey{}).Where("user_id = ?", userID)
	var total int64
	query.Count(&total)

	var list []model.APIKey
	if err := query.Order("created_at DESC").Offset(offset).Limit(pageSize).Find(&list).Error; err != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal("failed to list api keys"))
		return
	}
	response.Paginated(c, list, total, page, pageSize)
}

// Create 创建 API 密钥，返回的明文仅此一次可见。
func (h *APIKeyHandler) Create(c *gin.Context) {
	userID := c.GetString(middleware.CtxUserID)

	var req struct {
		Name        string     `json:"name"`
		Description string     `json:"description"`
		ExpiresAt   *time.Time `json:"expiresAt"`
		RPMOverride *int       `json:"rpmOverride"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, pkgerrors.BadRequest(err.Error()))
		return
	}

	if req.RPMOverride != nil {
		c.JSON(403, pkgerrors.Forbidden("only administrators may change rate limits"))
		return
	}
	plain, err := keys.Generate()
	if err != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal("failed to generate key"))
		return
	}

	apiKey := model.APIKey{
		UserID:      userID,
		Name:        req.Name,
		KeyHash:     keys.Hash(plain),
		KeyPrefix:   keys.DisplayPrefix(plain),
		Description: req.Description,
		ExpiresAt:   req.ExpiresAt,
		RPMOverride: nil,
	}
	if err := h.db.Create(&apiKey).Error; err != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal("failed to create api key"))
		return
	}

	// 仅在创建响应中返回明文 key。
	response.Created(c, gin.H{"apiKey": apiKey, "key": plain})
}

// Update 修改 API 密钥的名称、描述、过期时间或限流值。
func (h *APIKeyHandler) Update(c *gin.Context) {
	userID := c.GetString(middleware.CtxUserID)
	id := c.Param("id")

	var req struct {
		Name        *string    `json:"name"`
		Description *string    `json:"description"`
		ExpiresAt   *time.Time `json:"expiresAt"`
		RPMOverride *int       `json:"rpmOverride"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, pkgerrors.BadRequest(err.Error()))
		return
	}

	updates := map[string]any{}
	if req.Name != nil {
		updates["name"] = *req.Name
	}
	if req.Description != nil {
		updates["description"] = *req.Description
	}
	if req.ExpiresAt != nil {
		updates["expires_at"] = *req.ExpiresAt
	}
	if req.RPMOverride != nil {
		c.JSON(http.StatusForbidden, pkgerrors.Forbidden("only administrators may change rate limits"))
		return
	}
	if len(updates) == 0 {
		response.NoContent(c)
		return
	}

	result := h.db.Model(&model.APIKey{}).Where("id = ? AND user_id = ?", id, userID).Updates(updates)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal("failed to update api key"))
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, pkgerrors.NotFound("api key not found"))
		return
	}
	response.NoContent(c)
}

// apiKeyWithUser 管理端列表项：密钥 + 所属用户名。
type apiKeyWithUser struct {
	model.APIKey
	Username string `json:"username"`
}

// AdminList 列出全站 API 密钥（管理员），可按名称/前缀/用户名/邮箱过滤。
func (h *APIKeyHandler) AdminList(c *gin.Context) {
	page, pageSize, offset := parsePagination(c)
	q := strings.TrimSpace(c.Query("q"))

	applyFilter := func(tx *gorm.DB) *gorm.DB {
		tx = tx.Table("api_key ak").Joins("LEFT JOIN app_user u ON u.id = ak.user_id")
		if q != "" {
			p := "%" + q + "%"
			tx = tx.Where("ak.name ILIKE ? OR ak.key_prefix ILIKE ? OR u.username ILIKE ? OR u.email ILIKE ?", p, p, p, p)
		}
		return tx
	}

	var total int64
	applyFilter(h.db).Count(&total)

	var rows []apiKeyWithUser
	if err := applyFilter(h.db).
		Select("ak.*, u.username AS username").
		Order("ak.created_at DESC").
		Offset(offset).Limit(pageSize).
		Scan(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal("failed to list api keys"))
		return
	}
	response.Paginated(c, rows, total, page, pageSize)
}

// AdminUpdate 管理员修改任意 API 密钥（含撤销/恢复）。
func (h *APIKeyHandler) AdminUpdate(c *gin.Context) {
	id := c.Param("id")
	var req struct {
		Name        *string    `json:"name"`
		Description *string    `json:"description"`
		ExpiresAt   *time.Time `json:"expiresAt"`
		RPMOverride *int       `json:"rpmOverride"`
		IsRevoked   *bool      `json:"isRevoked"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, pkgerrors.BadRequest(err.Error()))
		return
	}
	updates := map[string]any{}
	if req.Name != nil {
		updates["name"] = *req.Name
	}
	if req.Description != nil {
		updates["description"] = *req.Description
	}
	if req.ExpiresAt != nil {
		updates["expires_at"] = *req.ExpiresAt
	}
	if req.RPMOverride != nil {
		if *req.RPMOverride < 1 || *req.RPMOverride > 10000 {
			c.JSON(400, pkgerrors.BadRequest("rpmOverride must be 1..10000"))
			return
		}
		updates["rpm_override"] = *req.RPMOverride
	}
	if req.IsRevoked != nil {
		updates["is_revoked"] = *req.IsRevoked
	}
	if len(updates) == 0 {
		response.NoContent(c)
		return
	}
	result := h.db.Model(&model.APIKey{}).Where("id = ?", id).Updates(updates)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal("failed to update api key"))
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, pkgerrors.NotFound("api key not found"))
		return
	}
	response.NoContent(c)
}

// AdminDelete 管理员删除任意 API 密钥。
func (h *APIKeyHandler) AdminDelete(c *gin.Context) {
	id := c.Param("id")
	result := h.db.Where("id = ?", id).Delete(&model.APIKey{})
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal("failed to delete api key"))
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, pkgerrors.NotFound("api key not found"))
		return
	}
	response.NoContent(c)
}

// Revoke 撤销 API 密钥（不可再用于鉴权）。
func (h *APIKeyHandler) Revoke(c *gin.Context) {
	userID := c.GetString(middleware.CtxUserID)
	id := c.Param("id")

	result := h.db.Model(&model.APIKey{}).Where("id = ? AND user_id = ?", id, userID).Update("is_revoked", true)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal("failed to revoke api key"))
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, pkgerrors.NotFound("api key not found"))
		return
	}
	response.NoContent(c)
}

// Delete 删除 API 密钥。
func (h *APIKeyHandler) Delete(c *gin.Context) {
	userID := c.GetString(middleware.CtxUserID)
	id := c.Param("id")

	result := h.db.Where("id = ? AND user_id = ?", id, userID).Delete(&model.APIKey{})
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal("failed to delete api key"))
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, pkgerrors.NotFound("api key not found"))
		return
	}
	response.NoContent(c)
}
