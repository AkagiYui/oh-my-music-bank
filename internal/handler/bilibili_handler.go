package handler

import (
	"context"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/akagiyui/oh-my-music-bank/internal/service/audioproc"
	"github.com/akagiyui/oh-my-music-bank/internal/service/bilibili"
	"github.com/akagiyui/oh-my-music-bank/internal/service/cache"
	"github.com/akagiyui/oh-my-music-bank/internal/service/recognize"
	"github.com/akagiyui/oh-my-music-bank/internal/storage/objectstore"
	pkgerrors "github.com/akagiyui/oh-my-music-bank/pkg/errors"
	"github.com/akagiyui/oh-my-music-bank/pkg/response"
)

// BilibiliHandler 处理从哔哩哔哩收藏夹导入音频、裁剪、听歌识曲。
type BilibiliHandler struct {
	db    *gorm.DB
	store *objectstore.Store
	cache *cache.Manager
	bili  *bilibili.Client

	mu       sync.Mutex
	urlCache map[string]cachedURL
}

type cachedURL struct {
	url string
	at  time.Time
}

// NewBilibiliHandler 创建处理器。
func NewBilibiliHandler(db *gorm.DB, store *objectstore.Store, c *cache.Manager, bili *bilibili.Client) *BilibiliHandler {
	return &BilibiliHandler{db: db, store: store, cache: c, bili: bili, urlCache: map[string]cachedURL{}}
}

func (h *BilibiliHandler) cookie() string { return h.cache.GetSetting("bilibili.cookie") }

func (h *BilibiliHandler) requireCookie(c *gin.Context) bool {
	if h.cookie() == "" {
		c.JSON(http.StatusBadRequest, pkgerrors.New("not_configured", "请先在「集成」中配置哔哩哔哩 Cookie"))
		return false
	}
	return true
}

// Status 返回是否已配置 Cookie。
func (h *BilibiliHandler) Status(c *gin.Context) {
	response.Success(c, gin.H{"configured": h.cookie() != ""})
}

// Favorites 列出收藏夹。
func (h *BilibiliHandler) Favorites(c *gin.Context) {
	if !h.requireCookie(c) {
		return
	}
	folders, err := h.bili.FavFolders(c.Request.Context(), h.cookie())
	if err != nil {
		c.JSON(http.StatusBadGateway, pkgerrors.New("bilibili_error", err.Error()))
		return
	}
	response.Success(c, folders)
}

// FavoriteItems 分页列出收藏夹中的视频。
func (h *BilibiliHandler) FavoriteItems(c *gin.Context) {
	if !h.requireCookie(c) {
		return
	}
	mediaID, _ := strconv.ParseInt(c.Param("mediaId"), 10, 64)
	pn, _ := strconv.Atoi(c.DefaultQuery("pn", "1"))
	items, hasMore, err := h.bili.FavResources(c.Request.Context(), h.cookie(), mediaID, pn)
	if err != nil {
		c.JSON(http.StatusBadGateway, pkgerrors.New("bilibili_error", err.Error()))
		return
	}
	response.Success(c, gin.H{"items": items, "hasMore": hasMore})
}

// Resolve 返回视频信息（含分 P 的 cid），供前端选择与裁剪。
func (h *BilibiliHandler) Resolve(c *gin.Context) {
	if !h.requireCookie(c) {
		return
	}
	bvid := strings.TrimSpace(c.Query("bvid"))
	if bvid == "" {
		c.JSON(http.StatusBadRequest, pkgerrors.BadRequest("bvid required"))
		return
	}
	info, err := h.bili.View(c.Request.Context(), h.cookie(), bvid)
	if err != nil {
		c.JSON(http.StatusBadGateway, pkgerrors.New("bilibili_error", err.Error()))
		return
	}
	response.Success(c, info)
}

// audioURL 解析并缓存音频直链（约 120 分钟有效，缓存 100 分钟）。
func (h *BilibiliHandler) audioURL(ctx context.Context, bvid string, cid int64) (string, error) {
	key := bvid + ":" + strconv.FormatInt(cid, 10)
	h.mu.Lock()
	if cu, ok := h.urlCache[key]; ok && time.Since(cu.at) < 100*time.Minute {
		h.mu.Unlock()
		return cu.url, nil
	}
	h.mu.Unlock()

	stream, err := h.bili.BestAudio(ctx, h.cookie(), bvid, cid)
	if err != nil {
		return "", err
	}
	h.mu.Lock()
	h.urlCache[key] = cachedURL{url: stream.URL, at: time.Now()}
	h.mu.Unlock()
	return stream.URL, nil
}

// Stream 代理哔哩哔哩音频（携带 Referer），支持 Range，供前端裁剪预览。
// 通过 MediaTokenAuth（query token）鉴权。
func (h *BilibiliHandler) Stream(c *gin.Context) {
	bvid := strings.TrimSpace(c.Query("bvid"))
	cid, _ := strconv.ParseInt(c.Query("cid"), 10, 64)
	if bvid == "" || cid == 0 {
		c.JSON(http.StatusBadRequest, pkgerrors.BadRequest("bvid/cid required"))
		return
	}
	audioURL, err := h.audioURL(c.Request.Context(), bvid, cid)
	if err != nil {
		c.JSON(http.StatusBadGateway, pkgerrors.New("bilibili_error", err.Error()))
		return
	}
	resp, err := h.bili.FetchAudio(c.Request.Context(), audioURL, c.GetHeader("Range"))
	if err != nil {
		c.JSON(http.StatusBadGateway, pkgerrors.New("bilibili_error", err.Error()))
		return
	}
	defer resp.Body.Close()

	for _, k := range []string{"Content-Type", "Content-Length", "Content-Range", "Accept-Ranges"} {
		if v := resp.Header.Get(k); v != "" {
			c.Header(k, v)
		}
	}
	if c.Writer.Header().Get("Content-Type") == "" {
		c.Header("Content-Type", "audio/mp4")
	}
	c.Status(resp.StatusCode)
	io.Copy(c.Writer, resp.Body)
}

// downloadToTemp 下载音频到临时文件，返回路径（调用方负责删除）。
func (h *BilibiliHandler) downloadToTemp(ctx context.Context, bvid string, cid int64) (string, error) {
	audioURL, err := h.audioURL(ctx, bvid, cid)
	if err != nil {
		return "", err
	}
	tmp, err := os.CreateTemp("", "ommb-bili-*.m4a")
	if err != nil {
		return "", err
	}
	defer tmp.Close()
	if err := h.bili.Download(ctx, audioURL, tmp); err != nil {
		os.Remove(tmp.Name())
		return "", err
	}
	return tmp.Name(), nil
}

// Ingest 把（可裁剪的）视频音频加入音乐库，保留原始编码。
func (h *BilibiliHandler) Ingest(c *gin.Context) {
	if !h.requireCookie(c) {
		return
	}
	var req struct {
		Bvid     string  `json:"bvid" binding:"required"`
		Cid      int64   `json:"cid" binding:"required"`
		StartSec float64 `json:"startSec"`
		EndSec   float64 `json:"endSec"`
		Title    string  `json:"title"`
		Artist   string  `json:"artist"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, pkgerrors.BadRequest(err.Error()))
		return
	}

	info, _ := h.bili.View(c.Request.Context(), h.cookie(), req.Bvid)

	srcPath, err := h.downloadToTemp(c.Request.Context(), req.Bvid, req.Cid)
	if err != nil {
		c.JSON(http.StatusBadGateway, pkgerrors.New("bilibili_error", err.Error()))
		return
	}
	defer os.Remove(srcPath)

	ingestPath := srcPath
	if req.StartSec > 0 || req.EndSec > req.StartSec {
		trimmed, err := os.CreateTemp("", "ommb-trim-*.m4a")
		if err == nil {
			trimmed.Close()
			if err := audioproc.Trim(srcPath, trimmed.Name(), req.StartSec, req.EndSec); err == nil {
				ingestPath = trimmed.Name()
				defer os.Remove(trimmed.Name())
			} else {
				os.Remove(trimmed.Name())
			}
		}
	}

	title, artist, cover := req.Title, req.Artist, ""
	if info != nil {
		if title == "" {
			title = info.Title
		}
		if artist == "" {
			artist = info.Owner
		}
		cover = info.Cover
	}

	track, dedup, err := ingestAudioFile(c.Request.Context(), h.db, h.store, ingestPath, "m4a", ingestOptions{
		Title: title, Artist: artist, Source: "bilibili:" + req.Bvid, CoverURL: cover,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal(err.Error()))
		return
	}
	dto := buildTrackDTO(h.db, h.store, track, true)
	if dedup {
		response.Success(c, gin.H{"deduplicated": true, "track": dto})
		return
	}
	response.Created(c, dto)
}

// Recognize 截取片段送听歌识曲，返回候选。
func (h *BilibiliHandler) Recognize(c *gin.Context) {
	if !h.requireCookie(c) {
		return
	}
	var req struct {
		Bvid     string  `json:"bvid" binding:"required"`
		Cid      int64   `json:"cid" binding:"required"`
		StartSec float64 `json:"startSec"`
		EndSec   float64 `json:"endSec"`
		Provider string  `json:"provider"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, pkgerrors.BadRequest(err.Error()))
		return
	}

	srcPath, err := h.downloadToTemp(c.Request.Context(), req.Bvid, req.Cid)
	if err != nil {
		c.JSON(http.StatusBadGateway, pkgerrors.New("bilibili_error", err.Error()))
		return
	}
	defer os.Remove(srcPath)

	segLen := req.EndSec - req.StartSec
	if segLen <= 0 {
		segLen = 20
	}
	if segLen > 58 {
		segLen = 58
	}

	provider := req.Provider
	if provider == "" {
		provider = "xfyun"
	}

	switch provider {
	case "xfyun":
		pcm, err := os.CreateTemp("", "ommb-rec-*.pcm")
		if err != nil {
			c.JSON(http.StatusInternalServerError, pkgerrors.Internal("temp"))
			return
		}
		pcm.Close()
		defer os.Remove(pcm.Name())
		if err := audioproc.ToPCM16kMono(srcPath, pcm.Name(), req.StartSec, segLen); err != nil {
			c.JSON(http.StatusInternalServerError, pkgerrors.Internal("转码失败: "+err.Error()))
			return
		}
		data, err := os.ReadFile(pcm.Name())
		if err != nil {
			c.JSON(http.StatusInternalServerError, pkgerrors.Internal("read pcm"))
			return
		}
		creds := recognize.XfyunCreds{
			AppID:  h.cache.GetSetting("xfyun.app_id"),
			APIKey: h.cache.GetSetting("xfyun.api_key"),
		}
		cands, err := recognize.Xfyun(c.Request.Context(), creds, data)
		if err != nil {
			c.JSON(http.StatusBadGateway, pkgerrors.New("recognize_error", err.Error()))
			return
		}
		response.Success(c, cands)
	case "netease":
		// 网易云识别需要 afp 指纹后端，本仓库未内置，返回明确说明。
		_, err := recognize.NeteaseMatch(c.Request.Context(), "", int(segLen))
		c.JSON(http.StatusNotImplemented, pkgerrors.New("not_implemented", err.Error()))
	default:
		c.JSON(http.StatusBadRequest, pkgerrors.BadRequest("unknown provider"))
	}
}
