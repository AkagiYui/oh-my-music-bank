package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	jwt "github.com/golang-jwt/jwt/v5"
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

type jwtClaims struct {
	UserID string `json:"user_id"`
	jwt.RegisteredClaims
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
	accessTTL, err := h.cfg.AccessTokenDuration()
	if err != nil {
		return "", "", err
	}
	refreshTTL, err := h.cfg.RefreshTokenDuration()
	if err != nil {
		return "", "", err
	}
	now := time.Now()
	mk := func(ttl time.Duration) (string, error) {
		claims := jwtClaims{
			UserID: u.ID,
			RegisteredClaims: jwt.RegisteredClaims{
				ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
				IssuedAt:  jwt.NewNumericDate(now),
			},
		}
		return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(h.cfg.JWTSecret))
	}
	access, err := mk(accessTTL)
	if err != nil {
		return "", "", err
	}
	refresh, err := mk(refreshTTL)
	if err != nil {
		return "", "", err
	}
	return access, refresh, nil
}

// Register 注册新用户；首个用户自动成为管理员。
func (h *AuthHandler) Register(c *gin.Context) {
	var count int64
	if err := h.db.Model(&model.User{}).Count(&count).Error; err != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal("failed to check user count"))
		return
	}
	// 首个用户始终允许注册（初始化管理员），其后遵循站点注册开关。
	if count > 0 && h.cache.GetSettingDefault("site.registration_enabled", "true") == "false" {
		c.JSON(http.StatusForbidden, pkgerrors.Forbidden("registration is disabled"))
		return
	}

	var req struct {
		Username string `json:"username" binding:"required,min=3,max=64"`
		Email    string `json:"email"    binding:"required,email"`
		Password string `json:"password" binding:"required,min=8"`
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

	role := "user"
	if count == 0 {
		role = "admin"
	}
	user := model.User{
		Username:     req.Username,
		Email:        req.Email,
		PasswordHash: string(hash),
		Role:         role,
		IsActive:     true,
	}
	if err := h.db.Create(&user).Error; err != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal("failed to create user"))
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

	token, err := jwt.ParseWithClaims(req.RefreshToken, &jwtClaims{}, func(_ *jwt.Token) (any, error) {
		return []byte(h.cfg.JWTSecret), nil
	})
	if err != nil || !token.Valid {
		c.JSON(http.StatusUnauthorized, pkgerrors.Unauthorized("invalid or expired refresh token"))
		return
	}
	claims, ok := token.Claims.(*jwtClaims)
	if !ok {
		c.JSON(http.StatusUnauthorized, pkgerrors.Unauthorized("invalid token claims"))
		return
	}

	var user model.User
	if err := h.db.Where("id = ? AND is_active = true", claims.UserID).First(&user).Error; err != nil {
		c.JSON(http.StatusUnauthorized, pkgerrors.Unauthorized("user not found"))
		return
	}

	access, refresh, err := h.generateTokens(&user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal("failed to generate tokens"))
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
