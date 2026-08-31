package handler

import (
	"github.com/akagiyui/oh-my-music-bank/internal/service/objectgc"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

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
	c.Set("admin_search", true)
	(&PublicHandler{db: h.db, store: h.store}).Search(c)
}

func (h *TrackHandler) Detail(c *gin.Context) {
	t, ok := h.find(c)
	if !ok {
		return
	}
	dto := buildTrackDTO(c, h.db, h.store, t, true)
	dto.Origins = buildOrigins(c, h.db, h.store, t.ID)

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
		if strings.TrimSpace(*req.Title) == "" {
			c.JSON(400, pkgerrors.BadRequest("标题不能为空"))
			return
		}
		updates["title"] = *req.Title
	}
	if req.Duration != nil {
		if *req.Duration < 0 {
			c.JSON(400, pkgerrors.BadRequest("时长不能为负数"))
			return
		}
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
	err := h.db.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var track model.Track
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&track, id).Error; err != nil {
			return err
		}
		var audio []model.Audio
		var origins []model.OriginAudio
		if err := tx.Where("track_id = ?", id).Find(&audio).Error; err != nil {
			return err
		}
		if err := tx.Where("track_id = ?", id).Find(&origins).Error; err != nil {
			return err
		}
		keys := []string{}
		for _, a := range audio {
			keys = append(keys, a.FileKey)
		}
		for _, a := range origins {
			keys = append(keys, a.FileKey)
		}
		if track.CoverKey != nil {
			keys = append(keys, *track.CoverKey)
		}
		for _, k := range keys {
			if err := objectgc.Schedule(tx, k, 0); err != nil {
				return err
			}
		}
		return tx.Delete(&track).Error
	})
	if err != nil {
		c.JSON(422, pkgerrors.BadRequest("删除失败: "+err.Error()))
		return
	}
	response.NoContent(c)
}

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
				return err
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
				return err
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
