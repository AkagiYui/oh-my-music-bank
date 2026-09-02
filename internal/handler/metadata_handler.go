package handler

import (
	"errors"
	"fmt"
	"github.com/akagiyui/oh-my-music-bank/internal/service/objectgc"
	"gorm.io/gorm/clause"
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

	// 先验证目标，再下载封面；关系和基础字段在一个事务中提交。
	var original model.Track
	if err := h.db.First(&original, id).Error; err != nil {
		c.JSON(404, pkgerrors.NotFound("track not found"))
		return
	}
	coverKey := ""
	if req.CoverURL != nil && strings.TrimSpace(*req.CoverURL) != "" {
		var err error
		coverKey, err = downloadCover(c.Request.Context(), h.db, h.store, *req.CoverURL)
		if err != nil {
			c.JSON(422, pkgerrors.BadRequest(err.Error()))
			return
		}
	}
	err := h.db.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var track model.Track
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&track, id).Error; err != nil {
			return err
		}
		updates := map[string]any{}
		if req.Title != nil {
			if strings.TrimSpace(*req.Title) == "" {
				return fmt.Errorf("标题不能为空")
			}
			updates["title"] = strings.TrimSpace(*req.Title)
		}
		if req.Lyric != nil {
			updates["lyric"] = *req.Lyric
		}
		if req.LRCLyric != nil {
			updates["lrc_lyric"] = *req.LRCLyric
		}
		if req.CoverURL != nil {
			updates["cover_key"] = coverKey
			if track.CoverKey != nil {
				if err := objectgc.Schedule(tx, objectstore.BucketPublic, *track.CoverKey, 0); err != nil {
					return err
				}
			}
		}
		if len(updates) > 0 {
			if err := tx.Model(&track).Updates(updates).Error; err != nil {
				return err
			}
		}
		if req.Artists != nil {
			if err := tx.Where("track_id = ?", id).Delete(&model.TrackArtist{}).Error; err != nil {
				return err
			}
			seen := map[string]bool{}
			for i, name := range req.Artists {
				name = strings.TrimSpace(name)
				if name == "" || seen[name] {
					continue
				}
				seen[name] = true
				artist, err := upsertArtist(tx, name)
				if err != nil {
					return err
				}
				if err := tx.Create(&model.TrackArtist{TrackID: id, ArtistID: artist.ID, Position: i}).Error; err != nil {
					return err
				}
			}
		}
		if req.Album != nil {
			if err := tx.Where("track_id = ?", id).Delete(&model.TrackAlbum{}).Error; err != nil {
				return err
			}
			if title := strings.TrimSpace(*req.Album); title != "" {
				if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", "album:"+title).Error; err != nil {
					return err
				}
				var album model.Album
				if err := tx.Where("title = ?", title).First(&album).Error; errors.Is(err, gorm.ErrRecordNotFound) {
					album.Title = title
					if err = tx.Create(&album).Error; err != nil {
						return err
					}
				} else if err != nil {
					return err
				}
				if err := tx.Create(&model.TrackAlbum{TrackID: id, AlbumID: album.ID}).Error; err != nil {
					return err
				}
			}
		}
		return nil
	})
	if err != nil {
		c.JSON(422, pkgerrors.BadRequest("补全失败，数据库修改已回滚: "+err.Error()))
		return
	}
	var track model.Track
	if err := h.db.First(&track, id).Error; err != nil {
		c.JSON(500, pkgerrors.Internal("读取曲目失败"))
		return
	}
	response.Success(c, buildTrackDTO(h.db, h.store, &track, true))
}
