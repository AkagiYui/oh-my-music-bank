package handler

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/akagiyui/oh-my-music-bank/internal/model"
	"github.com/akagiyui/oh-my-music-bank/internal/service/metadata"
	"github.com/akagiyui/oh-my-music-bank/internal/storage/objectstore"
	pkgerrors "github.com/akagiyui/oh-my-music-bank/pkg/errors"
	"github.com/akagiyui/oh-my-music-bank/pkg/response"
)

// MetadataHandler 接入网易云元信息搜索，并把匹配结果应用到曲目。
type MetadataHandler struct {
	db    *gorm.DB
	store *objectstore.Store
}

// NewMetadataHandler 创建元信息处理器。
func NewMetadataHandler(db *gorm.DB, store *objectstore.Store) *MetadataHandler {
	return &MetadataHandler{db: db, store: store}
}

// Search 按关键词搜索元信息候选。
func (h *MetadataHandler) Search(c *gin.Context) {
	q := strings.TrimSpace(c.Query("q"))
	if q == "" {
		response.Success(c, []metadata.SongMeta{})
		return
	}
	res, err := metadata.Search(c.Request.Context(), q)
	if err != nil {
		c.JSON(http.StatusBadGateway, pkgerrors.New("metadata_error", err.Error()))
		return
	}
	response.Success(c, res)
}

// Song 返回单曲完整元信息（含歌词）。
func (h *MetadataHandler) Song(c *gin.Context) {
	m, err := metadata.Detail(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadGateway, pkgerrors.New("metadata_error", err.Error()))
		return
	}
	response.Success(c, m)
}

// Enrich 把元信息应用到曲目：标题/歌词/封面/艺术家/专辑。
func (h *MetadataHandler) Enrich(c *gin.Context) {
	id, ok := parseTrackID(c)
	if !ok {
		return
	}
	var req struct {
		Title    *string  `json:"title"`
		Lyric    *string  `json:"lyric"`
		LRCLyric *string  `json:"lrcLyric"`
		Album    *string  `json:"album"`
		CoverURL *string  `json:"coverUrl"`
		Artists  []string `json:"artists"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, pkgerrors.BadRequest(err.Error()))
		return
	}

	updates := map[string]any{}
	if req.Title != nil {
		updates["title"] = *req.Title
	}
	if req.Lyric != nil {
		updates["lyric"] = *req.Lyric
	}
	if req.LRCLyric != nil {
		updates["lrc_lyric"] = *req.LRCLyric
	}
	if len(updates) > 0 {
		h.db.Model(&model.Track{}).Where("id = ?", id).Updates(updates)
	}

	// 艺术家：按名称去重创建并替换关联。
	if len(req.Artists) > 0 {
		h.db.Transaction(func(tx *gorm.DB) error {
			tx.Where("track_id = ?", id).Delete(&model.TrackArtist{})
			for i, name := range req.Artists {
				name = strings.TrimSpace(name)
				if name == "" {
					continue
				}
				artist, err := upsertArtist(tx, name)
				if err != nil {
					return err
				}
				tx.Create(&model.TrackArtist{TrackID: id, ArtistID: artist.ID, Position: i})
			}
			return nil
		})
	}

	// 专辑：按标题去重创建并关联。
	if req.Album != nil && strings.TrimSpace(*req.Album) != "" {
		var album model.Album
		if err := h.db.Where("title = ?", *req.Album).First(&album).Error; err != nil {
			album = model.Album{Title: *req.Album}
			h.db.Create(&album)
		}
		var cnt int64
		h.db.Model(&model.TrackAlbum{}).Where("track_id = ? AND album_id = ?", id, album.ID).Count(&cnt)
		if cnt == 0 {
			h.db.Create(&model.TrackAlbum{TrackID: id, AlbumID: album.ID})
		}
	}

	// 封面：下载到对象存储。
	if req.CoverURL != nil && strings.TrimSpace(*req.CoverURL) != "" {
		if key, err := downloadCover(c.Request.Context(), h.store, id, *req.CoverURL); err == nil {
			h.db.Model(&model.Track{}).Where("id = ?", id).Update("cover_key", key)
		}
	}

	var t model.Track
	if err := h.db.Where("id = ?", id).First(&t).Error; err != nil {
		c.JSON(http.StatusNotFound, pkgerrors.NotFound("track not found"))
		return
	}
	response.Success(c, buildTrackDTO(h.db, h.store, &t, true))
}
