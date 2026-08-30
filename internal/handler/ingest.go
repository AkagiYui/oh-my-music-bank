package handler

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/akagiyui/oh-my-music-bank/internal/model"
	"github.com/akagiyui/oh-my-music-bank/internal/service/audiometa"
	"github.com/akagiyui/oh-my-music-bank/internal/storage/objectstore"
	"github.com/akagiyui/oh-my-music-bank/pkg/idgen"
)

// ingestOptions 入库可选项。
type ingestOptions struct {
	Title    string
	Artist   string
	Source   string // 收录来源，如 upload / bilibili:BVxxx
	CoverURL string // 远程封面地址（无内嵌封面时下载）
}

// ingestAudioFile 把本地音频文件落库并上传对象存储，返回曲目（或去重命中的曲目）。
// 解析标题/艺术家/时长/响度等元信息；尽量保留原始编码（不转码）。
func ingestAudioFile(ctx context.Context, db *gorm.DB, store *objectstore.Store, filePath, ext string, opts ingestOptions) (*model.Track, bool, error) {
	// 计算哈希。
	f, err := os.Open(filePath)
	if err != nil {
		return nil, false, err
	}
	hasher := sha256.New()
	size, err := io.Copy(hasher, f)
	f.Close()
	if err != nil {
		return nil, false, err
	}
	hash := hex.EncodeToString(hasher.Sum(nil))

	// 去重。
	var existing model.OriginAudio
	if err := db.Where("hash = ?", hash).First(&existing).Error; err == nil {
		var t model.Track
		if err := db.Where("id = ?", existing.TrackID).First(&t).Error; err == nil {
			return &t, true, nil
		}
	}

	meta, _ := audiometa.Parse(filePath)
	title := firstNonEmpty(opts.Title, meta.Title, "未命名")
	ext = strings.TrimPrefix(strings.ToLower(ext), ".")
	if ext == "" {
		ext = firstNonEmpty(meta.Format, "bin")
	}

	fileKey := fmt.Sprintf("audio/%s.%s", hash, ext)
	up, err := os.Open(filePath)
	if err != nil {
		return nil, false, err
	}
	if err := store.Put(ctx, fileKey, up, size, "audio/"+ext); err != nil {
		up.Close()
		return nil, false, fmt.Errorf("上传对象存储失败: %w", err)
	}
	up.Close()

	trackID := idgen.Next()
	source := opts.Source
	err = db.Transaction(func(tx *gorm.DB) error {
		track := model.Track{Title: title, Duration: meta.Duration, Available: true}
		track.ID = trackID
		if meta.Lyric != "" {
			track.Lyric = &meta.Lyric
		}
		if err := tx.Create(&track).Error; err != nil {
			return err
		}
		origin := model.OriginAudio{
			TrackID: trackID, Size: size, FileKey: fileKey, Hash: hash,
			Duration: meta.Duration, Bitrate: meta.Bitrate, ChannelCount: meta.ChannelCount,
			SamplingRate: meta.SamplingRate, BitDepth: meta.BitDepth, Format: meta.Format,
			Encoder: meta.Encoder, Status: model.OriginStatusReady,
		}
		if err := tx.Create(&origin).Error; err != nil {
			return err
		}
		audio := model.Audio{
			TrackID: trackID, Size: size, FileKey: fileKey, Hash: hash,
			Duration: meta.Duration, Bitrate: meta.Bitrate, ChannelCount: meta.ChannelCount,
			SamplingRate: meta.SamplingRate, BitDepth: meta.BitDepth, Format: meta.Format,
			Encoder: meta.Encoder, HasLyric: meta.Lyric != "", HasCover: meta.HasCover,
			Loudness: meta.Loudness, QualityLabel: qualityLabel(meta.Bitrate, meta.BitDepth, meta.Format),
		}
		if source != "" {
			audio.Source = &source
		}
		if err := tx.Create(&audio).Error; err != nil {
			return err
		}
		if name := firstNonEmpty(opts.Artist, meta.Artist); name != "" {
			artist, err := upsertArtist(tx, name)
			if err != nil {
				return err
			}
			if err := tx.Create(&model.TrackArtist{TrackID: trackID, ArtistID: artist.ID, Position: 0}).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		go store.Remove(context.Background(), fileKey)
		return nil, false, fmt.Errorf("写库失败: %w", err)
	}

	// 封面：优先内嵌，其次远程下载。
	if meta.HasCover && len(meta.CoverData) > 0 {
		coverKey := fmt.Sprintf("cover/%d.%s", trackID, coverExtFromMime(meta.CoverMime))
		if err := store.Put(ctx, coverKey, bytes.NewReader(meta.CoverData), int64(len(meta.CoverData)), meta.CoverMime); err == nil {
			db.Model(&model.Track{}).Where("id = ?", trackID).Update("cover_key", coverKey)
		}
	} else if opts.CoverURL != "" {
		if key, err := downloadCover(ctx, store, trackID, opts.CoverURL); err == nil {
			db.Model(&model.Track{}).Where("id = ?", trackID).Update("cover_key", key)
		}
	}

	var t model.Track
	db.Where("id = ?", trackID).First(&t)
	return &t, false, nil
}

// downloadCover 下载远程封面到对象存储，返回 key。
func downloadCover(ctx context.Context, store *objectstore.Store, trackID int64, coverURL string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, coverURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0")
	req.Header.Set("Referer", "https://www.bilibili.com")
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("cover http %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return "", err
	}
	mime := resp.Header.Get("Content-Type")
	ext := coverExtFromMime(mime)
	if ext == "img" {
		if e := strings.TrimPrefix(strings.ToLower(path.Ext(coverURL)), "."); e != "" {
			ext = e
		}
	}
	key := fmt.Sprintf("cover/%d.%s", trackID, ext)
	if err := store.Put(ctx, key, bytes.NewReader(data), int64(len(data)), mime); err != nil {
		return "", err
	}
	return key, nil
}

// upsertArtist 按名称查找艺术家，不存在则创建。
func upsertArtist(tx *gorm.DB, name string) (*model.Artist, error) {
	var artist model.Artist
	if err := tx.Where("name = ?", name).First(&artist).Error; err == nil {
		return &artist, nil
	}
	artist = model.Artist{Name: name}
	artist.ID = idgen.Next()
	if err := tx.Create(&artist).Error; err != nil {
		return nil, err
	}
	return &artist, nil
}

// qualityLabel 依据码率/位深/格式粗略判定音质档位。
func qualityLabel(bitrate, bitDepth int, format string) string {
	f := strings.ToLower(format)
	if strings.Contains(f, "flac") || strings.Contains(f, "wav") || strings.Contains(f, "ape") || bitDepth >= 24 {
		return "lossless"
	}
	if bitrate >= 256000 {
		return "high"
	}
	return "standard"
}

// coverExtFromMime 由封面 MIME 推断扩展名。
func coverExtFromMime(mime string) string {
	switch {
	case strings.Contains(mime, "jpeg"), strings.Contains(mime, "jpg"):
		return "jpg"
	case strings.Contains(mime, "png"):
		return "png"
	case strings.Contains(mime, "webp"):
		return "webp"
	default:
		return "img"
	}
}

// firstNonEmpty 返回第一个非空字符串。
func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
