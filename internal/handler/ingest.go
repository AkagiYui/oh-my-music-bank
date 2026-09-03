package handler

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"github.com/akagiyui/oh-my-music-bank/internal/service/objectgc"
	"github.com/akagiyui/oh-my-music-bank/internal/service/safefetch"
	"github.com/google/uuid"
	"io"
	"mime"
	"net/http"
	"os"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

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
	TrackID  int64
	CoverURL string // 远程封面地址（无内嵌封面时下载）
}

// ingestAudioFile 把本地音频文件落库并上传对象存储，返回曲目（或去重命中的曲目）。
// 解析标题/艺术家/时长/响度等元信息；尽量保留原始编码（不转码）。
func ingestAudioFile(ctx context.Context, db *gorm.DB, store objectstore.Stores, filePath, ext string, opts ingestOptions) (*model.Track, bool, error) {
	// 计算哈希。
	f, err := os.Open(filePath)
	if err != nil {
		return nil, false, err
	}
	reportJob(ctx, db, "校验文件与去重", 30)
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
			if opts.TrackID != 0 && opts.TrackID != t.ID {
				return nil, false, fmt.Errorf("文件已属于曲目 %d，请使用合并功能", t.ID)
			}
			if err := completeJob(ctx, db, t.ID, true); err != nil {
				return nil, false, err
			}
			return &t, true, nil
		}
	}

	reportJob(ctx, db, "解析音轨与测量响度", 45)
	meta, err := audiometa.Parse(ctx, filePath)
	if err != nil {
		return nil, false, err
	}
	title := firstNonEmpty(opts.Title, meta.Title, "未命名")
	ext = strings.TrimPrefix(strings.ToLower(ext), ".")
	if ext == "" {
		ext = firstNonEmpty(meta.Format, "bin")
	}

	reportJob(ctx, db, "保存音频与封面", 75)
	fileKey := fmt.Sprintf("audio/%s.%s", uuid.NewString(), ext)
	if err := objectgc.Schedule(db, objectstore.BucketPrivate, fileKey, 24*time.Hour); err != nil {
		return nil, false, err
	}
	up, err := os.Open(filePath)
	if err != nil {
		return nil, false, err
	}
	if err := store.Private.Put(ctx, fileKey, up, size, mime.TypeByExtension("."+ext)); err != nil {
		up.Close()
		return nil, false, fmt.Errorf("上传对象存储失败: %w", err)
	}
	up.Close()

	trackID := opts.TrackID
	if trackID == 0 {
		trackID = idgen.Next()
	}
	coverKey := ""
	if opts.TrackID == 0 {
		if meta.HasCover && len(meta.CoverData) > 0 {
			if len(meta.CoverData) > 8<<20 {
				return nil, false, fmt.Errorf("封面超过8MB")
			}
			coverKey = fmt.Sprintf("cover/%s.%s", uuid.NewString(), coverExtFromMime(meta.CoverMime))
			if err := objectgc.Schedule(db, objectstore.BucketPublic, coverKey, 24*time.Hour); err != nil {
				return nil, false, err
			}
			if err := store.Public.Put(ctx, coverKey, bytes.NewReader(meta.CoverData), int64(len(meta.CoverData)), meta.CoverMime); err != nil {
				return nil, false, err
			}
		} else if opts.CoverURL != "" {
			var e error
			coverKey, e = downloadCover(ctx, db, store.Public, opts.CoverURL)
			if e != nil {
				return nil, false, e
			}
		}
	}
	source := opts.Source
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		track := model.Track{Title: title, Duration: meta.Duration, Available: true, ID: trackID}
		if coverKey != "" {
			track.CoverKey = &coverKey
		}
		if meta.Lyric != "" {
			track.Lyric = &meta.Lyric
		}
		if opts.TrackID == 0 {
			if err := tx.Create(&track).Error; err != nil {
				return err
			}
		} else {
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", trackID).First(&track).Error; err != nil {
				return err
			}
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
		if name := firstNonEmpty(opts.Artist, meta.Artist); opts.TrackID == 0 && name != "" {
			artist, err := upsertArtist(tx, name)
			if err != nil {
				return err
			}
			if err := tx.Create(&model.TrackArtist{TrackID: trackID, ArtistID: artist.ID, Position: 0}).Error; err != nil {
				return err
			}
		}
		if opts.TrackID == 0 && strings.TrimSpace(meta.Album) != "" {
			if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", "album:"+meta.Album).Error; err != nil {
				return err
			}
			var album model.Album
			if err := tx.Where("title = ?", meta.Album).First(&album).Error; errors.Is(err, gorm.ErrRecordNotFound) {
				album.Title = meta.Album
				if err = tx.Create(&album).Error; err != nil {
					return err
				}
			} else if err != nil {
				return err
			}
			if err := tx.Create(&model.TrackAlbum{TrackID: trackID, AlbumID: album.ID}).Error; err != nil {
				return err
			}
		}
		return completeJob(ctx, tx, trackID, false)
	})
	if err != nil {
		_ = objectgc.Schedule(db, objectstore.BucketPrivate, fileKey, 0)
		var found model.OriginAudio
		if e := db.Where("hash = ?", hash).First(&found).Error; e == nil {
			var t model.Track
			if e = db.First(&t, found.TrackID).Error; e == nil {
				if opts.TrackID != 0 && opts.TrackID != t.ID {
					return nil, false, fmt.Errorf("文件已属于曲目 %d，请使用合并功能", t.ID)
				}
				if err := completeJob(ctx, db, t.ID, true); err != nil {
					return nil, false, err
				}
				return &t, true, nil
			}
		}
		return nil, false, fmt.Errorf("写库失败: %w", err)
	}

	// 封面：优先内嵌，其次远程下载。
	var t model.Track
	if err := db.Where("id = ?", trackID).First(&t).Error; err != nil {
		return nil, false, err
	}
	return &t, false, nil
}

// downloadCover 下载远程封面到对象存储，返回 key。
func downloadCover(ctx context.Context, db *gorm.DB, store *objectstore.Public, coverURL string) (string, error) {
	if err := safefetch.ValidateURL(coverURL); err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, coverURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0")
	req.Header.Set("Referer", "https://www.bilibili.com")
	client := safefetch.Client()
	defer client.CloseIdleConnections()
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("cover http %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, (8<<20)+1))
	if err != nil {
		return "", err
	}
	if len(data) > 8<<20 {
		return "", errors.New("封面超过 8MB")
	}
	mime := http.DetectContentType(data)
	ext := coverExtFromMime(mime)
	if ext == "img" {
		return "", errors.New("封面必须为 JPEG、PNG 或 WebP 图片")
	}
	key := fmt.Sprintf("cover/%s.%s", uuid.NewString(), ext)
	if err := objectgc.Schedule(db, objectstore.BucketPublic, key, 24*time.Hour); err != nil {
		return "", err
	}
	if err := store.Put(ctx, key, bytes.NewReader(data), int64(len(data)), mime); err != nil {
		return "", err
	}
	return key, nil
}

// upsertArtist 按名称查找艺术家，不存在则创建。
func upsertArtist(tx *gorm.DB, name string) (*model.Artist, error) {
	if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", "artist:"+name).Error; err != nil {
		return nil, err
	}
	var artist model.Artist
	if err := tx.Where("name = ?", name).First(&artist).Error; err == nil {
		return &artist, nil
	}
	artist = model.Artist{Name: name, ID: idgen.Next()}
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
