package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"github.com/akagiyui/oh-my-music-bank/internal/middleware"
	"github.com/akagiyui/oh-my-music-bank/internal/model"
	pkgerrors "github.com/akagiyui/oh-my-music-bank/pkg/errors"
	"github.com/akagiyui/oh-my-music-bank/pkg/response"
)

// UserHandler 处理管理员的用户管理与当前用户的个人资料修改。
type UserHandler struct {
	db *gorm.DB
}

// NewUserHandler 创建用户处理器。
func NewUserHandler(db *gorm.DB) *UserHandler {
	return &UserHandler{db: db}
}

// List 列出全部用户（管理员）。
func (h *UserHandler) List(c *gin.Context) {
	page, pageSize, offset := parsePagination(c)
	query := h.db.Model(&model.User{})
	var total int64
	query.Count(&total)

	var users []model.User
	if err := query.Order("created_at DESC").Offset(offset).Limit(pageSize).Find(&users).Error; err != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal("failed to list users"))
		return
	}
	response.Paginated(c, users, total, page, pageSize)
}

// UpdateRole 修改用户角色（管理员）。
func (h *UserHandler) UpdateRole(c *gin.Context) {
	id := c.Param("id")
	var req struct {
		Role string `json:"role" binding:"required,oneof=admin user"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, pkgerrors.BadRequest(err.Error()))
		return
	}
	if err := h.db.Model(&model.User{}).Where("id = ?", id).Update("role", req.Role).Error; err != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal("failed to update role"))
		return
	}
	response.NoContent(c)
}

// ToggleActive 启用/禁用用户（管理员）。
func (h *UserHandler) ToggleActive(c *gin.Context) {
	id := c.Param("id")
	var req struct {
		IsActive bool `json:"isActive"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, pkgerrors.BadRequest(err.Error()))
		return
	}
	if err := h.db.Model(&model.User{}).Where("id = ?", id).Update("is_active", req.IsActive).Error; err != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal("failed to update user"))
		return
	}
	response.NoContent(c)
}

// Delete 删除用户（管理员）。其 API 密钥随级联删除。
func (h *UserHandler) Delete(c *gin.Context) {
	id := c.Param("id")
	if id == c.GetString(middleware.CtxUserID) {
		c.JSON(http.StatusBadRequest, pkgerrors.BadRequest("cannot delete yourself"))
		return
	}
	if err := h.db.Where("id = ?", id).Delete(&model.User{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal("failed to delete user"))
		return
	}
	response.NoContent(c)
}

// UpdateProfileEmail 当前用户修改邮箱。
func (h *UserHandler) UpdateProfileEmail(c *gin.Context) {
	userID := c.GetString(middleware.CtxUserID)
	var req struct {
		Email string `json:"email" binding:"required,email"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, pkgerrors.BadRequest(err.Error()))
		return
	}
	var existing model.User
	if err := h.db.Where("email = ? AND id <> ?", req.Email, userID).First(&existing).Error; err == nil {
		c.JSON(http.StatusConflict, pkgerrors.Conflict("email already in use"))
		return
	}
	if err := h.db.Model(&model.User{}).Where("id = ?", userID).Update("email", req.Email).Error; err != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal("failed to update email"))
		return
	}
	response.NoContent(c)
}

// ChangeProfilePassword 当前用户修改密码。
func (h *UserHandler) ChangeProfilePassword(c *gin.Context) {
	userID := c.GetString(middleware.CtxUserID)
	var req struct {
		CurrentPassword string `json:"currentPassword" binding:"required"`
		NewPassword     string `json:"newPassword"     binding:"required,min=8"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, pkgerrors.BadRequest(err.Error()))
		return
	}

	var user model.User
	if err := h.db.Where("id = ?", userID).First(&user).Error; err != nil {
		c.JSON(http.StatusNotFound, pkgerrors.NotFound("user not found"))
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.CurrentPassword)); err != nil {
		c.JSON(http.StatusUnauthorized, pkgerrors.Unauthorized("current password is incorrect"))
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), 12)
	if err != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal("failed to hash password"))
		return
	}
	if err := h.db.Model(&model.User{}).Where("id = ?", userID).Update("password_hash", string(hash)).Error; err != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal("failed to update password"))
		return
	}
	response.NoContent(c)
}
