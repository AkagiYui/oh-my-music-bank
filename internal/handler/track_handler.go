package handler

import (
	"context"
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

// TrackHandler 处理管理员的曲目管理。
type TrackHandler struct {
	db    *gorm.DB
	store *objectstore.Store
}

// NewTrackHandler 创建曲目处理器。
func NewTrackHandler(db *gorm.DB, store *objectstore.Store) *TrackHandler {
	return &TrackHandler{db: db, store: store}
}

// List 列出曲目（管理员，含不可用曲目，可按关键词过滤）。
func (h *TrackHandler) List(c *gin.Context) {
	page, pageSize, offset := parsePagination(c)
	query := h.db.Model(&model.Track{})
	if q := strings.TrimSpace(c.Query("q")); q != "" {
		query = query.Where("title ILIKE ?", "%"+q+"%")
	}

	var total int64
	query.Count(&total)

	var tracks []model.Track
	if err := query.Order("created_at DESC").Offset(offset).Limit(pageSize).Find(&tracks).Error; err != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal("failed to list tracks"))
		return
	}

	ids := make([]int64, len(tracks))
	for i, t := range tracks {
		ids[i] = t.ID
	}
	artistMap := loadArtistsForTracks(h.db, ids)

	out := make([]TrackDTO, 0, len(tracks))
	for i := range tracks {
		t := tracks[i]
		dto := TrackDTO{
			ID: itoa(t.ID), Title: t.Title, Duration: t.Duration,
			Available: t.Available, Aliases: []string{}, Artists: artistMap[t.ID],
		}
		if dto.Artists == nil {
			dto.Artists = []ArtistDTO{}
		}
		if t.CoverKey != nil {
			dto.CoverURL = h.store.PublicURL(*t.CoverKey)
		}
		out = append(out, dto)
	}
	response.Paginated(c, out, total, page, pageSize)
}

// Detail 返回曲目详情（含音频与原始音频）。
func (h *TrackHandler) Detail(c *gin.Context) {
	t, ok := h.find(c)
	if !ok {
		return
	}
	dto := buildTrackDTO(h.db, h.store, t, true)
	dto.Origins = buildOrigins(h.db, h.store, t.ID)

	var aliasRows []model.TrackAlias
	h.db.Where("track_id = ?", t.ID).Order("alias ASC").Find(&aliasRows)
	for _, a := range aliasRows {
		dto.AliasRows = append(dto.AliasRows, AliasRow{ID: itoa(a.ID), Alias: a.Alias})
	}
	response.Success(c, dto)
}

// Update 修改曲目基础字段。
func (h *TrackHandler) Update(c *gin.Context) {
	id, ok := parseTrackID(c)
	if !ok {
		return
	}
	var req struct {
		Title     *string `json:"title"`
		Duration  *int    `json:"duration"`
		Available *bool   `json:"available"`
		Lyric     *string `json:"lyric"`
		LRCLyric  *string `json:"lrcLyric"`
		LiveID    *int64  `json:"liveId,string"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, pkgerrors.BadRequest(err.Error()))
		return
	}
	updates := map[string]any{}
	if req.Title != nil {
		updates["title"] = *req.Title
	}
	if req.Duration != nil {
		updates["duration"] = *req.Duration
	}
	if req.Available != nil {
		updates["available"] = *req.Available
	}
	if req.Lyric != nil {
		updates["lyric"] = *req.Lyric
	}
	if req.LRCLyric != nil {
		updates["lrc_lyric"] = *req.LRCLyric
	}
	if req.LiveID != nil {
		updates["live_id"] = *req.LiveID
	}
	if len(updates) == 0 {
		response.NoContent(c)
		return
	}
	if err := h.db.Model(&model.Track{}).Where("id = ?", id).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal("failed to update track"))
		return
	}
	response.NoContent(c)
}

// Delete 删除曲目（级联删除关联与音频记录），并尽力清理对象存储。
func (h *TrackHandler) Delete(c *gin.Context) {
	id, ok := parseTrackID(c)
	if !ok {
		return
	}

	// 收集待清理的对象 key。
	var keysToRemove []string
	var audios []model.Audio
	h.db.Where("track_id = ?", id).Find(&audios)
	for _, a := range audios {
		keysToRemove = append(keysToRemove, a.FileKey)
	}
	var origins []model.OriginAudio
	h.db.Where("track_id = ?", id).Find(&origins)
	for _, o := range origins {
		keysToRemove = append(keysToRemove, o.FileKey)
	}
	var t model.Track
	if err := h.db.Where("id = ?", id).First(&t).Error; err == nil && t.CoverKey != nil {
		keysToRemove = append(keysToRemove, *t.CoverKey)
	}

	if err := h.db.Where("id = ?", id).Delete(&model.Track{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal("failed to delete track"))
		return
	}

	// 对象存储清理为 best-effort，失败不影响删除结果。
	go func(ks []string) {
		for _, k := range ks {
			_ = h.store.Remove(context.Background(), k)
		}
	}(keysToRemove)

	response.NoContent(c)
}

// AddAlias 为曲目添加别名。
func (h *TrackHandler) AddAlias(c *gin.Context) {
	id, ok := parseTrackID(c)
	if !ok {
		return
	}
	var req struct {
		Alias string `json:"alias" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, pkgerrors.BadRequest(err.Error()))
		return
	}
	alias := model.TrackAlias{TrackID: id, Alias: req.Alias}
	if err := h.db.Create(&alias).Error; err != nil {
		c.JSON(http.StatusConflict, pkgerrors.Conflict("alias already exists or invalid"))
		return
	}
	response.Created(c, alias)
}

// DeleteAlias 删除曲目别名。
func (h *TrackHandler) DeleteAlias(c *gin.Context) {
	id, ok := parseTrackID(c)
	if !ok {
		return
	}
	aliasID := c.Param("aliasId")
	if err := h.db.Where("id = ? AND track_id = ?", aliasID, id).Delete(&model.TrackAlias{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal("failed to delete alias"))
		return
	}
	response.NoContent(c)
}

// SetArtists 用给定艺术家列表（按顺序）替换曲目的艺术家关联。
func (h *TrackHandler) SetArtists(c *gin.Context) {
	id, ok := parseTrackID(c)
	if !ok {
		return
	}
	var req struct {
		ArtistIDs []string `json:"artistIds"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, pkgerrors.BadRequest(err.Error()))
		return
	}

	err := h.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("track_id = ?", id).Delete(&model.TrackArtist{}).Error; err != nil {
			return err
		}
		for i, sid := range req.ArtistIDs {
			aid, err := strconv.ParseInt(sid, 10, 64)
			if err != nil {
				continue
			}
			if err := tx.Create(&model.TrackArtist{TrackID: id, ArtistID: aid, Position: i}).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal("failed to set artists"))
		return
	}
	response.NoContent(c)
}

// SetAlbums 用给定专辑列表替换曲目的专辑关联。
func (h *TrackHandler) SetAlbums(c *gin.Context) {
	id, ok := parseTrackID(c)
	if !ok {
		return
	}
	var req struct {
		AlbumIDs []string `json:"albumIds"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, pkgerrors.BadRequest(err.Error()))
		return
	}
	err := h.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("track_id = ?", id).Delete(&model.TrackAlbum{}).Error; err != nil {
			return err
		}
		for _, sid := range req.AlbumIDs {
			aid, err := strconv.ParseInt(sid, 10, 64)
			if err != nil {
				continue
			}
			if err := tx.Create(&model.TrackAlbum{TrackID: id, AlbumID: aid}).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal("failed to set albums"))
		return
	}
	response.NoContent(c)
}

// SetLanguages 用给定语种列表替换曲目的语种关联。
func (h *TrackHandler) SetLanguages(c *gin.Context) {
	id, ok := parseTrackID(c)
	if !ok {
		return
	}
	var req struct {
		LanguageIDs []int `json:"languageIds"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, pkgerrors.BadRequest(err.Error()))
		return
	}
	err := h.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("track_id = ?", id).Delete(&model.TrackLanguage{}).Error; err != nil {
			return err
		}
		for _, lid := range req.LanguageIDs {
			if err := tx.Create(&model.TrackLanguage{TrackID: id, LanguageID: lid}).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal("failed to set languages"))
		return
	}
	response.NoContent(c)
}

// find 按路径 id 读取曲目。
func (h *TrackHandler) find(c *gin.Context) (*model.Track, bool) {
	id, ok := parseTrackID(c)
	if !ok {
		return nil, false
	}
	var t model.Track
	if err := h.db.Where("id = ?", id).First(&t).Error; err != nil {
		c.JSON(http.StatusNotFound, pkgerrors.NotFound("track not found"))
		return nil, false
	}
	return &t, true
}

// parseTrackID 解析路径中的曲目 id。
func parseTrackID(c *gin.Context) (int64, bool) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, pkgerrors.BadRequest("invalid track id"))
		return 0, false
	}
	return id, true
}
