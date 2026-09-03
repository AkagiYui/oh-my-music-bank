package handler

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/akagiyui/oh-my-music-bank/internal/service/objectgc"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/akagiyui/oh-my-music-bank/internal/model"
	"github.com/akagiyui/oh-my-music-bank/internal/storage/objectstore"
	pkgerrors "github.com/akagiyui/oh-my-music-bank/pkg/errors"
	"github.com/akagiyui/oh-my-music-bank/pkg/response"
)

// AlbumHandler 处理管理员的专辑管理。
type AlbumHandler struct {
	db    *gorm.DB
	store *objectstore.Public
}

// NewAlbumHandler 创建专辑处理器。
func NewAlbumHandler(db *gorm.DB, store *objectstore.Public) *AlbumHandler {
	return &AlbumHandler{db: db, store: store}
}

type albumListItem struct {
	ID         string `json:"id"`
	Title      string `json:"title"`
	CoverURL   string `json:"coverUrl,omitempty"`
	TrackCount int64  `json:"trackCount"`
}

type albumTrackBrief struct {
	TrackNo  *int   `json:"trackNo"`
	DiscNo   *int   `json:"discNo"`
	ID       string `json:"id"`
	Title    string `json:"title"`
	Duration int    `json:"duration"`
}

type albumDetailDTO struct {
	ID       string            `json:"id"`
	Title    string            `json:"title"`
	CoverKey string            `json:"coverKey,omitempty"`
	CoverURL string            `json:"coverUrl,omitempty"`
	Artists  []ArtistDTO       `json:"artists"`
	Tracks   []albumTrackBrief `json:"tracks"`
}

// List 列出专辑（可按关键词过滤），含曲目数量。
func (h *AlbumHandler) List(c *gin.Context) {
	page, pageSize, offset := parsePagination(c)
	query := h.db.Model(&model.Album{})
	if q := strings.TrimSpace(c.Query("q")); q != "" {
		query = query.Where("title ILIKE ?", "%"+q+"%")
	}
	var total int64
	query.Count(&total)

	var albums []model.Album
	if err := query.Order("title ASC").Offset(offset).Limit(pageSize).Find(&albums).Error; err != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal("failed to list albums"))
		return
	}

	counts := map[int64]int64{}
	if len(albums) > 0 {
		ids := make([]int64, len(albums))
		for i, a := range albums {
			ids[i] = a.ID
		}
		var rows []struct {
			AlbumID int64
			Cnt     int64
		}
		h.db.Table("track_albums").Select("album_id, COUNT(*) AS cnt").
			Where("album_id IN ?", ids).Group("album_id").Scan(&rows)
		for _, r := range rows {
			counts[r.AlbumID] = r.Cnt
		}
	}

	out := make([]albumListItem, 0, len(albums))
	for _, a := range albums {
		item := albumListItem{ID: itoa(a.ID), Title: a.Title, TrackCount: counts[a.ID]}
		if a.CoverKey != nil {
			item.CoverURL = h.store.URL(*a.CoverKey)
		}
		out = append(out, item)
	}
	response.Paginated(c, out, total, page, pageSize)
}

// Detail 返回专辑详情（艺术家、曲目）。
func (h *AlbumHandler) Detail(c *gin.Context) {
	id, ok := parseInt64Param(c, "id")
	if !ok {
		return
	}
	var album model.Album
	if err := h.db.Where("id = ?", id).First(&album).Error; err != nil {
		c.JSON(http.StatusNotFound, pkgerrors.NotFound("album not found"))
		return
	}
	dto := albumDetailDTO{ID: itoa(album.ID), Title: album.Title, Artists: []ArtistDTO{}, Tracks: []albumTrackBrief{}}
	if album.CoverKey != nil {
		dto.CoverKey = *album.CoverKey
		dto.CoverURL = h.store.URL(*album.CoverKey)
	}

	var artists []struct {
		ID   int64
		Name string
	}
	h.db.Table("artist_albums aa").Select("a.id, a.name").
		Joins("JOIN artist a ON a.id = aa.artist_id").Where("aa.album_id = ?", id).Scan(&artists)
	for _, a := range artists {
		dto.Artists = append(dto.Artists, ArtistDTO{ID: itoa(a.ID), Name: a.Name})
	}

	var tracks []struct {
		TrackNo  *int
		DiscNo   *int
		ID       int64
		Title    string
		Duration int
	}
	h.db.Table("track_albums ta").Select("t.id, t.title, t.duration, ta.track_no, ta.disc_no").
		Joins("JOIN track t ON t.id = ta.track_id").Where("ta.album_id = ?", id).
		Order("ta.disc_no ASC NULLS LAST, ta.track_no ASC NULLS LAST, t.id").Scan(&tracks)
	for _, t := range tracks {
		dto.Tracks = append(dto.Tracks, albumTrackBrief{ID: itoa(t.ID), Title: t.Title, Duration: t.Duration, TrackNo: t.TrackNo, DiscNo: t.DiscNo})
	}
	response.Success(c, dto)
}

// Create 新建专辑。
func (h *AlbumHandler) Create(c *gin.Context) {
	var req struct {
		Title    string  `json:"title" binding:"required"`
		CoverKey *string `json:"coverKey"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, pkgerrors.BadRequest(err.Error()))
		return
	}
	album := model.Album{Title: req.Title, CoverKey: req.CoverKey}
	if err := h.db.Create(&album).Error; err != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal("failed to create album"))
		return
	}
	response.Created(c, album)
}

// Update 修改专辑标题或封面。
func (h *AlbumHandler) Update(c *gin.Context) {
	id, ok := parseInt64Param(c, "id")
	if !ok {
		return
	}
	var req struct {
		Title    *string `json:"title"`
		CoverKey *string `json:"coverKey"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, pkgerrors.BadRequest(err.Error()))
		return
	}
	updates := map[string]any{}
	if req.Title != nil {
		updates["title"] = *req.Title
	}
	if req.CoverKey != nil {
		updates["cover_key"] = *req.CoverKey
	}
	if len(updates) == 0 {
		response.NoContent(c)
		return
	}
	if err := h.db.Model(&model.Album{}).Where("id = ?", id).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal("failed to update album"))
		return
	}
	response.NoContent(c)
}

// Delete 删除专辑（级联解除关联）。
func (h *AlbumHandler) Delete(c *gin.Context) {
	err := h.db.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var item model.Album
		if err := tx.Where("id = ?", c.Param("id")).First(&item).Error; err != nil {
			return err
		}
		if item.CoverKey != nil {
			if err := objectgc.Schedule(tx, objectstore.BucketPublic, *item.CoverKey, 0); err != nil {
				return err
			}
		}
		return tx.Delete(&item).Error
	})
	if err != nil {
		c.JSON(422, pkgerrors.BadRequest("删除失败: "+err.Error()))
		return
	}
	response.NoContent(c)
}

// SetArtists 用给定艺术家列表替换专辑的艺术家关联。
func (h *AlbumHandler) SetArtists(c *gin.Context) {
	id, ok := parseInt64Param(c, "id")
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
		if err := tx.Where("album_id = ?", id).Delete(&model.ArtistAlbum{}).Error; err != nil {
			return err
		}
		for _, sid := range req.ArtistIDs {
			aid, err := strconv.ParseInt(sid, 10, 64)
			if err != nil {
				continue
			}
			if err := tx.Create(&model.ArtistAlbum{ArtistID: aid, AlbumID: id}).Error; err != nil {
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
