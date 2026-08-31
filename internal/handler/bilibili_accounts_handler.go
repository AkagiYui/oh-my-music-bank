package handler

import (
	"context"
	"errors"
	"github.com/akagiyui/oh-my-music-bank/internal/middleware"
	"github.com/akagiyui/oh-my-music-bank/internal/service/bilibili"
	pkgerrors "github.com/akagiyui/oh-my-music-bank/pkg/errors"
	"github.com/akagiyui/oh-my-music-bank/pkg/response"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"time"
)

func accountError(c *gin.Context, err error) {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(404, pkgerrors.NotFound("账号或登录会话不存在"))
		return
	}
	if errors.Is(err, bilibili.ErrLoginExpired) {
		c.JSON(409, pkgerrors.New("bilibili_expired", err.Error()))
		return
	}
	// 数据库错误可能包含 SQL 参数，因此只对协议层错误输出可控信息。
	c.JSON(502, pkgerrors.New("bilibili_account_error", "账号操作未完成，请检查网络后重试；登录失效时请重新扫码"))
}

func (h *BilibiliHandler) Accounts(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	rows, err := h.accounts.List(c.Request.Context())
	if err != nil {
		accountError(c, err)
		return
	}
	response.Success(c, rows)
}

func (h *BilibiliHandler) CreateLogin(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(c.Request.Context(), 20*time.Second)
	defer cancel()
	v, err := h.accounts.CreateLogin(ctx, c.GetString(middleware.CtxUserID))
	if err != nil {
		accountError(c, err)
		return
	}
	response.Success(c, v)
}

func (h *BilibiliHandler) PollLogin(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(c.Request.Context(), 25*time.Second)
	defer cancel()
	v, err := h.accounts.PollLogin(ctx, c.GetString(middleware.CtxUserID), c.Param("loginId"))
	if err != nil {
		accountError(c, err)
		return
	}
	response.Success(c, v)
}

func (h *BilibiliHandler) DefaultAccount(c *gin.Context) {
	if err := h.accounts.SetDefault(c.Request.Context(), c.Param("accountId")); err != nil {
		accountError(c, err)
		return
	}
	response.NoContent(c)
}

func (h *BilibiliHandler) DeleteAccount(c *gin.Context) {
	if err := h.accounts.Delete(c.Request.Context(), c.Param("accountId")); err != nil {
		accountError(c, err)
		return
	}
	response.NoContent(c)
}

func (h *BilibiliHandler) RefreshAccount(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 45*time.Second)
	defer cancel()
	v, err := h.accounts.Refresh(ctx, c.Param("accountId"), true)
	if err != nil {
		accountError(c, err)
		return
	}
	message := "账号状态正常，已检查 Cookie 刷新需求"
	if !v.CanRefresh {
		message = "账号已检查；旧账号缺少刷新凭据，请重新扫码以启用自动刷新"
	}
	if v.ConfirmPending {
		message = "新 Cookie 已保存，旧凭据确认暂未完成，将自动重试"
	}
	response.Success(c, gin.H{"account": v, "message": message})
}
