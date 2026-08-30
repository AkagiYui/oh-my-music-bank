package handler

import (
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/akagiyui/oh-my-music-bank/internal/model"
	"github.com/akagiyui/oh-my-music-bank/pkg/response"
)

// StatsHandler 提供全站运行数据统计。
type StatsHandler struct {
	db *gorm.DB
}

// NewStatsHandler 创建统计处理器。
func NewStatsHandler(db *gorm.DB) *StatsHandler {
	return &StatsHandler{db: db}
}

// Overview 返回各类资源总量与当日新增。
func (h *StatsHandler) Overview(c *gin.Context) {
	count := func(m any) int64 {
		var n int64
		h.db.Model(m).Count(&n)
		return n
	}

	now := time.Now()
	startOfDay := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())

	var reqTotal, reqToday, usersToday int64
	h.db.Model(&model.APIRequestLog{}).Count(&reqTotal)
	h.db.Model(&model.APIRequestLog{}).Where("created_at >= ?", startOfDay).Count(&reqToday)
	h.db.Model(&model.User{}).Where("created_at >= ?", startOfDay).Count(&usersToday)

	response.Success(c, gin.H{
		"users":         count(&model.User{}),
		"tracks":        count(&model.Track{}),
		"artists":       count(&model.Artist{}),
		"albums":        count(&model.Album{}),
		"audios":        count(&model.Audio{}),
		"originAudios":  count(&model.OriginAudio{}),
		"apiKeys":       count(&model.APIKey{}),
		"totalRequests": reqTotal,
		"requestsToday": reqToday,
		"newUsersToday": usersToday,
	})
}

// Timeseries 返回最近 N 天的每日调用量与注册量。
func (h *StatsHandler) Timeseries(c *gin.Context) {
	days, _ := strconv.Atoi(c.DefaultQuery("days", "30"))
	if days < 1 || days > 365 {
		days = 30
	}
	now := time.Now()
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).AddDate(0, 0, -(days - 1))

	load := func(table string) map[string]int64 {
		var rows []struct {
			Day string
			Cnt int64
		}
		h.db.Raw(
			"SELECT to_char(created_at::date, 'YYYY-MM-DD') AS day, COUNT(*) AS cnt FROM "+table+
				" WHERE created_at >= ? GROUP BY 1", start,
		).Scan(&rows)
		m := make(map[string]int64, len(rows))
		for _, r := range rows {
			m[r.Day] = r.Cnt
		}
		return m
	}

	reqMap := load("api_request_log")
	regMap := load("app_user")

	out := make([]gin.H, 0, days)
	for i := 0; i < days; i++ {
		d := start.AddDate(0, 0, i).Format("2006-01-02")
		out = append(out, gin.H{"date": d, "requests": reqMap[d], "registrations": regMap[d]})
	}
	response.Success(c, out)
}
