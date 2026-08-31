package handler

import (
	"errors"
	"net/http"

	"github.com/akagiyui/oh-my-music-bank/internal/middleware"
	"github.com/akagiyui/oh-my-music-bank/internal/service/session"

	"github.com/gin-gonic/gin"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"github.com/akagiyui/oh-my-music-bank/internal/config"
	"github.com/akagiyui/oh-my-music-bank/internal/model"
	"github.com/akagiyui/oh-my-music-bank/internal/service/cache"
	pkgerrors "github.com/akagiyui/oh-my-music-bank/pkg/errors"
	"github.com/akagiyui/oh-my-music-bank/pkg/response"
)

// AuthHandler 处理注册、登录、令牌刷新。
type AuthHandler struct {
	db    *gorm.DB
	cfg   config.Auth
	cache *cache.Manager
}

// NewAuthHandler 创建认证处理器。
func NewAuthHandler(db *gorm.DB, cfg config.Auth, c *cache.Manager) *AuthHandler {
	return &AuthHandler{db: db, cfg: cfg, cache: c}
}

type userResponse struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Email    string `json:"email"`
	Role     string `json:"role"`
}

type loginResponse struct {
	AccessToken  string       `json:"accessToken"`
	RefreshToken string       `json:"refreshToken"`
	User         userResponse `json:"user"`
}

func toUserResponse(u *model.User) userResponse {
	return userResponse{ID: u.ID, Username: u.Username, Email: u.Email, Role: u.Role}
}

// generateTokens 生成访问令牌与刷新令牌。
func (h *AuthHandler) generateTokens(u *model.User) (string, string, error) {
	return session.New(h.db, h.cfg, u)
}

func (h *AuthHandler) Register(c *gin.Context) {
	var req struct {
		Username string `json:"username" binding:"required,min=3,max=64"`
		Email    string `json:"email"    binding:"required,email"`
		Password string `json:"password" binding:"required,min=8,max=72"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, pkgerrors.BadRequest(err.Error()))
		return
	}

	var existing model.User
	if err := h.db.Where("username = ? OR email = ?", req.Username, req.Email).First(&existing).Error; err == nil {
		c.JSON(http.StatusConflict, pkgerrors.Conflict("username or email already exists"))
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), 12)
	if err != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal("failed to hash password"))
		return
	}

	user := model.User{Username: req.Username, Email: req.Email, PasswordHash: string(hash), Role: "user", IsActive: true}
	err = h.db.Transaction(func(tx *gorm.DB) error {
		// 首位管理员选举与管理员降级共用事务锁，跨实例也只允许一个初始化者。
		if err := tx.Exec("SELECT pg_advisory_xact_lock(91120002)").Error; err != nil {
			return err
		}
		var count int64
		if err := tx.Model(&model.User{}).Count(&count).Error; err != nil {
			return err
		}
		if count == 0 {
			user.Role = "admin"
		} else {
			var setting model.Setting
			if err := tx.Where("key = ?", "site.registration_enabled").First(&setting).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			if setting.Value == "false" {
				return errRegistrationDisabled
			}
		}
		return tx.Create(&user).Error
	})
	if errors.Is(err, errRegistrationDisabled) {
		c.JSON(http.StatusForbidden, pkgerrors.Forbidden("registration is disabled"))
		return
	}
	if err != nil {
		c.JSON(http.StatusConflict, pkgerrors.Conflict("创建失败，用户名或邮箱可能已存在"))
		return
	}

	access, refresh, err := h.generateTokens(&user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal("failed to generate tokens"))
		return
	}
	response.Created(c, loginResponse{AccessToken: access, RefreshToken: refresh, User: toUserResponse(&user)})
}

// Login 校验凭据并返回令牌对。
func (h *AuthHandler) Login(c *gin.Context) {
	var req struct {
		Email    string `json:"email"    binding:"required,email"`
		Password string `json:"password" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, pkgerrors.BadRequest(err.Error()))
		return
	}

	var user model.User
	if err := h.db.Where("email = ? AND is_active = true", req.Email).First(&user).Error; err != nil {
		c.JSON(http.StatusUnauthorized, pkgerrors.Unauthorized("invalid email or password"))
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, pkgerrors.Unauthorized("invalid email or password"))
		return
	}

	access, refresh, err := h.generateTokens(&user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal("failed to generate tokens"))
		return
	}
	response.Success(c, loginResponse{AccessToken: access, RefreshToken: refresh, User: toUserResponse(&user)})
}

// Refresh 用刷新令牌换取新的访问令牌。
func (h *AuthHandler) Refresh(c *gin.Context) {
	var req struct {
		RefreshToken string `json:"refreshToken" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, pkgerrors.BadRequest(err.Error()))
		return
	}

	access, refresh, err := session.Refresh(h.db, h.cfg, req.RefreshToken)
	if err != nil {
		c.JSON(http.StatusUnauthorized, pkgerrors.Unauthorized("invalid or expired refresh token"))
		return
	}

	response.Success(c, gin.H{"accessToken": access, "refreshToken": refresh})
}

// Me 返回当前登录用户信息。
func (h *AuthHandler) Me(c *gin.Context) {
	v, ok := c.Get("user")
	if !ok {
		c.JSON(http.StatusUnauthorized, pkgerrors.Unauthorized("not authenticated"))
		return
	}
	response.Success(c, toUserResponse(v.(*model.User)))
}

var errRegistrationDisabled = errors.New("registration disabled")

func (h *AuthHandler) Logout(c *gin.Context) {
	if err := h.db.Where("id = ? AND user_id = ?", c.GetString("session_id"), c.GetString(middleware.CtxUserID)).Delete(&model.AuthSession{}).Error; err != nil {
		c.JSON(500, pkgerrors.Internal("退出失败"))
		return
	}
	response.NoContent(c)
}
