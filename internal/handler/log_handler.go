package handler

import (
	"strconv"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/akagiyui/oh-my-music-bank/internal/model"
	"github.com/akagiyui/oh-my-music-bank/pkg/response"
)

// LogHandler 提供 API 调用日志查询（管理员）。
type LogHandler struct {
	db *gorm.DB
}

// NewLogHandler 创建日志处理器。
func NewLogHandler(db *gorm.DB) *LogHandler {
	return &LogHandler{db: db}
}

type logRow struct {
	model.APIRequestLog
	Username string `json:"username"`
	KeyName  string `json:"keyName"`
}

// List 列出调用日志，可按 API Key / 用户 / 状态码过滤。
func (h *LogHandler) List(c *gin.Context) {
	page, pageSize, offset := parsePagination(c)
	apiKeyID := c.Query("apiKeyId")
	userID := c.Query("userId")
	statusStr := c.Query("statusCode")

	applyFilter := func(tx *gorm.DB) *gorm.DB {
		tx = tx.Table("api_request_log l").
			Joins("LEFT JOIN app_user u ON u.id = l.user_id").
			Joins("LEFT JOIN api_key k ON k.id = l.api_key_id")
		if apiKeyID != "" {
			tx = tx.Where("l.api_key_id = ?", apiKeyID)
		}
		if userID != "" {
			tx = tx.Where("l.user_id = ?", userID)
		}
		if s, err := strconv.Atoi(statusStr); err == nil {
			tx = tx.Where("l.status_code = ?", s)
		}
		return tx
	}

	var total int64
	applyFilter(h.db).Count(&total)

	var rows []logRow
	applyFilter(h.db).
		Select("l.*, u.username AS username, k.name AS key_name").
		Order("l.created_at DESC").
		Offset(offset).Limit(pageSize).
		Scan(&rows)

	response.Paginated(c, rows, total, page, pageSize)
}
