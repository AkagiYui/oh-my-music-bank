package handler

import (
	"database/sql"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/akagiyui/oh-my-music-bank/internal/model"
	"github.com/akagiyui/oh-my-music-bank/internal/storage/objectstore"
	pkgerrors "github.com/akagiyui/oh-my-music-bank/pkg/errors"
	"github.com/akagiyui/oh-my-music-bank/pkg/response"
)

// PublicHandler 处理需 API Key 鉴权的开放接口。
type PublicHandler struct {
	db    *gorm.DB
	store *objectstore.Public
}

// NewPublicHandler 创建开放接口处理器。
func NewPublicHandler(db *gorm.DB, store *objectstore.Public) *PublicHandler {
	return &PublicHandler{db: db, store: store}
}

// 命中候选的 WHERE 条件：标题/别名/艺术家名模糊命中，或标题与查询的三元相似度达到阈值。
const searchWhere = `t.available AND (
	t.title ILIKE @pattern
	OR EXISTS (SELECT 1 FROM track_aliases al WHERE al.track_id = t.id AND al.alias ILIKE @pattern)
	OR EXISTS (SELECT 1 FROM track_artists ta JOIN artist a ON a.id = ta.artist_id WHERE ta.track_id = t.id AND a.name ILIKE @pattern)
	OR EXISTS (SELECT 1 FROM track_artists ta JOIN artist_aliases aa ON aa.artist_id=ta.artist_id WHERE ta.track_id=t.id AND aa.alias ILIKE @pattern)
 OR EXISTS (SELECT 1 FROM track_albums ta JOIN album al ON al.id=ta.album_id WHERE ta.track_id=t.id AND al.title ILIKE @pattern)
 OR similarity(t.title, @q) > 0.2
)`

// 相关性打分：标题精确 > 标题前缀 > 标题包含 > 标题相似度 > 艺术家相似度 > 别名命中/相似度。
const searchScore = `
	CASE WHEN lower(t.title) = lower(@q) THEN 100 ELSE 0 END
	+ CASE WHEN t.title ILIKE @prefix THEN 40 ELSE 0 END
	+ CASE WHEN t.title ILIKE @pattern THEN 20 ELSE 0 END
	+ similarity(t.title, @q) * 10
	+ COALESCE((SELECT MAX(similarity(a.name, @q)) * 8
		FROM track_artists ta JOIN artist a ON a.id = ta.artist_id WHERE ta.track_id = t.id), 0)
	+ COALESCE((SELECT MAX(CASE WHEN al.alias ILIKE @pattern THEN 15 ELSE similarity(al.alias, @q) * 6 END)
		FROM track_aliases al WHERE al.track_id = t.id), 0)`

// Search 多字段加权搜索可用曲目，按相关性排序返回。
func (h *PublicHandler) Search(c *gin.Context) {
	q := strings.TrimSpace(c.Query("q"))
	page, pageSize, offset := parsePagination(c)
	if q == "" && !c.GetBool("admin_search") && c.Query("album") == "" && c.Query("language") == "" && c.Query("quality") == "" {
		response.Paginated(c, []TrackDTO{}, 0, page, pageSize)
		return
	}
	pattern := "%" + q + "%"
	prefix := q + "%"

	where := searchWhere
	if c.GetBool("admin_search") {
		where = strings.TrimPrefix(where, "t.available AND ")
	}
	if c.Query("album") != "" {
		where += " AND EXISTS (SELECT 1 FROM track_albums ta JOIN album al ON al.id=ta.album_id WHERE ta.track_id=t.id AND al.title ILIKE @album)"
	}
	if c.Query("language") != "" {
		where += " AND EXISTS (SELECT 1 FROM track_languages tl JOIN language l ON l.id=tl.language_id WHERE tl.track_id=t.id AND l.name ILIKE @language)"
	}
	if c.Query("quality") != "" {
		where += " AND EXISTS (SELECT 1 FROM audio a WHERE a.track_id=t.id AND a.quality_label LIKE @quality)"
	}
	args := []any{sql.Named("q", q), sql.Named("pattern", pattern), sql.Named("prefix", prefix), sql.Named("limit", pageSize), sql.Named("offset", offset), sql.Named("album", "%"+c.Query("album")+"%"), sql.Named("language", "%"+c.Query("language")+"%"), sql.Named("quality", c.Query("quality")+"%")}
	var total int64
	if err := h.db.Raw("SELECT COUNT(*) FROM track t WHERE "+where, args...).Scan(&total).Error; err != nil {
		c.JSON(500, pkgerrors.Internal("search failed"))
		return
	}

	var ranked []struct {
		ID    int64
		Score float64
	}
	if err := h.db.Raw(
		"SELECT t.id AS id, ("+searchScore+") AS score FROM track t WHERE "+where+
			" ORDER BY score DESC, t.title ASC, t.id ASC LIMIT @limit OFFSET @offset",
		args...,
	).Scan(&ranked).Error; err != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal("search failed"))
		return
	}

	ids := make([]int64, len(ranked))
	for i, r := range ranked {
		ids[i] = r.ID
	}

	// 按打分顺序取回曲目（IN 查询不保序，需用 map 重排）。
	var tracks []model.Track
	if len(ids) > 0 {
		h.db.Where("id IN ?", ids).Find(&tracks)
	}
	byID := make(map[int64]model.Track, len(tracks))
	for _, t := range tracks {
		byID[t.ID] = t
	}
	artistMap := loadArtistsForTracks(h.db, ids)

	out := make([]TrackDTO, 0, len(ids))
	for _, id := range ids {
		t, ok := byID[id]
		if !ok {
			continue
		}
		dto := TrackDTO{
			ID:        itoa(t.ID),
			Title:     t.Title,
			Duration:  t.Duration,
			Available: t.Available,
			Aliases:   []string{},
			Artists:   artistMap[id],
		}
		if dto.Artists == nil {
			dto.Artists = []ArtistDTO{}
		}
		if t.CoverKey != nil {
			dto.CoverURL = h.store.URL(*t.CoverKey)
		}
		out = append(out, dto)
	}
	response.Paginated(c, out, total, page, pageSize)
}

// GetTrack 返回单个可用曲目的详情与音频元数据；播放地址由独立接口按需签发。
func (h *PublicHandler) GetTrack(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, pkgerrors.BadRequest("invalid track id"))
		return
	}
	var t model.Track
	if err := h.db.Where("id = ? AND available = true", id).First(&t).Error; err != nil {
		c.JSON(http.StatusNotFound, pkgerrors.NotFound("track not found"))
		return
	}
	response.Success(c, buildTrackDTO(h.db, h.store, &t, true))
}
