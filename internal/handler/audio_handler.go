package handler

import (
	"github.com/akagiyui/oh-my-music-bank/internal/service/objectgc"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/akagiyui/oh-my-music-bank/internal/config"
	"github.com/akagiyui/oh-my-music-bank/internal/model"
	"github.com/akagiyui/oh-my-music-bank/internal/storage/objectstore"
	pkgerrors "github.com/akagiyui/oh-my-music-bank/pkg/errors"
	"github.com/akagiyui/oh-my-music-bank/pkg/response"
)

// AudioHandler 处理管理员上传与音频管理。
type AudioHandler struct {
	db    *gorm.DB
	store objectstore.Stores
	cfg   config.Upload
}

type presignedURLDTO struct {
	URL       string    `json:"url"`
	ExpiresAt time.Time `json:"expiresAt"`
}

// NewAudioHandler 创建音频处理器。
func NewAudioHandler(db *gorm.DB, store objectstore.Stores, cfg config.Upload) *AudioHandler {
	return &AudioHandler{db: db, store: store, cfg: cfg}
}

// Upload 接收音频文件，自动解析信息、写库并上传至对象存储（保留原始格式）。
func (h *AudioHandler) Upload(c *gin.Context) {
	maxBytes := int64(h.cfg.MaxSizeMB) << 20

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBytes+(1<<20))
	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, pkgerrors.BadRequest("file is required"))
		return
	}
	if fileHeader.Size > maxBytes {
		c.JSON(http.StatusRequestEntityTooLarge, pkgerrors.New("file_too_large", "file exceeds size limit"))
		return
	}

	ext := strings.ToLower(filepath.Ext(fileHeader.Filename))
	switch ext {
	case ".mp3", ".m4a", ".mp4", ".flac", ".wav", ".ogg", ".opus", ".aac", ".aiff", ".ape":
	default:
		c.JSON(400, pkgerrors.BadRequest("不支持的音频扩展名"))
		return
	}
	src, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal("failed to open upload"))
		return
	}
	defer src.Close()

	tmp, err := os.CreateTemp("", "ommb-upload-*"+filepath.Ext(fileHeader.Filename))
	if err != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal("failed to create temp file"))
		return
	}
	defer os.Remove(tmp.Name())
	if _, err := io.Copy(tmp, src); err != nil {
		tmp.Close()
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal("failed to read upload"))
		return
	}
	tmp.Close()

	track, dedup, err := ingestAudioFile(c.Request.Context(), h.db, h.store, tmp.Name(), filepath.Ext(fileHeader.Filename), ingestOptions{
		Title:  strings.TrimSpace(c.PostForm("title")),
		Artist: strings.TrimSpace(c.PostForm("artist")),
		Source: "upload",
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal(err.Error()))
		return
	}

	dto := buildTrackDTO(h.db, h.store.Public, track, true)
	if dedup {
		response.Success(c, gin.H{"deduplicated": true, "track": dto})
		return
	}
	response.Created(c, gin.H{"deduplicated": false, "track": dto})
}

// DeleteAudio 删除某个音质档位的分发音频（同时清理对象）。
func (h *AudioHandler) DeleteAudio(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, pkgerrors.BadRequest("invalid audio id"))
		return
	}
	var audio model.Audio
	if err := h.db.Where("id = ?", id.String()).First(&audio).Error; err != nil {
		c.JSON(http.StatusNotFound, pkgerrors.NotFound("audio not found"))
		return
	}
	if err := h.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Delete(&audio).Error; err != nil {
			return err
		}
		return objectgc.Schedule(tx, objectstore.BucketPrivate, audio.FileKey, 0)
	}); err != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal("failed to delete audio"))
		return
	}

	response.NoContent(c)
}

// PublicPlaybackURL 在 API Key 鉴权后为可用曲目签发私有桶直连。
func (h *AudioHandler) PublicPlaybackURL(c *gin.Context) {
	h.playbackURL(c, false)
}

// AdminPlaybackURL 允许管理员试听尚未公开的曲目。
func (h *AudioHandler) AdminPlaybackURL(c *gin.Context) {
	h.playbackURL(c, true)
}

func (h *AudioHandler) playbackURL(c *gin.Context, allowUnavailable bool) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, pkgerrors.BadRequest("invalid audio id"))
		return
	}
	var audio model.Audio
	query := h.db.WithContext(c.Request.Context()).
		Joins("JOIN track ON track.id = audio.track_id").
		Where("audio.id = ?", id.String())
	if !allowUnavailable {
		query = query.Where("track.available = true")
	}
	if err := query.First(&audio).Error; err != nil {
		c.JSON(http.StatusNotFound, pkgerrors.NotFound("audio not found"))
		return
	}
	h.respondPresignedURL(c, audio.FileKey)
}

// OriginDownloadURL 为管理员签发原始音频下载直连。
func (h *AudioHandler) OriginDownloadURL(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, pkgerrors.BadRequest("invalid origin audio id"))
		return
	}
	var origin model.OriginAudio
	if err := h.db.WithContext(c.Request.Context()).Where("id = ?", id.String()).First(&origin).Error; err != nil {
		c.JSON(http.StatusNotFound, pkgerrors.NotFound("origin audio not found"))
		return
	}
	format := strings.ToLower(origin.Format)
	if format == "" || strings.IndexFunc(format, func(r rune) bool {
		return (r < 'a' || r > 'z') && (r < '0' || r > '9')
	}) >= 0 {
		format = "bin"
	}
	url, expiresAt, err := h.store.Private.PresignedDownload(c.Request.Context(), origin.FileKey, origin.ID+"."+format)
	if err != nil {
		c.JSON(http.StatusBadGateway, pkgerrors.Internal("failed to sign media URL"))
		return
	}
	respondPresignedURL(c, url, expiresAt)
}

func (h *AudioHandler) respondPresignedURL(c *gin.Context, key string) {
	url, expiresAt, err := h.store.Private.PresignedGet(c.Request.Context(), key)
	if err != nil {
		c.JSON(http.StatusBadGateway, pkgerrors.Internal("failed to sign media URL"))
		return
	}
	respondPresignedURL(c, url, expiresAt)
}

func respondPresignedURL(c *gin.Context, url string, expiresAt time.Time) {
	c.Header("Cache-Control", "private, no-store")
	c.Header("Referrer-Policy", "no-referrer")
	response.Success(c, presignedURLDTO{URL: url, ExpiresAt: expiresAt})
}
