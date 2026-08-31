package handler

import (
	"errors"
	"gorm.io/gorm/clause"
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
	if err := h.mutateUser(id, map[string]any{"role": req.Role}, false); err != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.BadRequest(err.Error()))
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
	if err := h.mutateUser(id, map[string]any{"is_active": req.IsActive}, false); err != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.BadRequest(err.Error()))
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
	if err := h.mutateUser(id, nil, true); err != nil {
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
		NewPassword     string `json:"newPassword"     binding:"required,min=8,max=72"`
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
	if err := h.db.Transaction(func(tx *gorm.DB) error {
		var current model.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", userID).First(&current).Error; err != nil {
			return err
		}
		if current.PasswordHash != user.PasswordHash {
			return errors.New("密码已变更，请重新登录")
		}
		if err := tx.Model(&current).Update("password_hash", string(hash)).Error; err != nil {
			return err
		}
		return tx.Where("user_id = ?", userID).Delete(&model.AuthSession{}).Error
	}); err != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal("failed to update password"))
		return
	}
	response.NoContent(c)
}

// 所有管理员变动共用事务锁，保证至少保留一位启用的管理员。
func (h *UserHandler) mutateUser(id string, updates map[string]any, remove bool) error {
	return h.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SELECT pg_advisory_xact_lock(91120002)").Error; err != nil {
			return err
		}
		var u model.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", id).First(&u).Error; err != nil {
			return err
		}
		losesAdmin := remove || updates["role"] == "user" || updates["is_active"] == false
		if u.Role == "admin" && u.IsActive && losesAdmin {
			var n int64
			if err := tx.Model(&model.User{}).Where("role = 'admin' AND is_active").Count(&n).Error; err != nil {
				return err
			}
			if n <= 1 {
				return errors.New("必须保留至少一位启用的管理员")
			}
		}
		if remove {
			return tx.Delete(&u).Error
		}
		if err := tx.Model(&u).Updates(updates).Error; err != nil {
			return err
		}
		if updates["is_active"] == false {
			return tx.Where("user_id = ?", id).Delete(&model.AuthSession{}).Error
		}
		return nil
	})
}
