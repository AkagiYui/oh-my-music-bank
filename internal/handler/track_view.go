package handler

import (
	"strconv"
	"time"

	"gorm.io/gorm"

	"github.com/akagiyui/oh-my-music-bank/internal/model"
	"github.com/akagiyui/oh-my-music-bank/internal/storage/objectstore"
)

// ArtistDTO 艺术家精简视图。
type ArtistDTO struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// AlbumDTO 专辑精简视图。
type AlbumDTO struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	CoverURL string `json:"coverUrl,omitempty"`
}

// LanguageDTO 语种视图。
type LanguageDTO struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

// AliasRow 带 id 的别名，供管理端编辑（删除需 id）。
type AliasRow struct {
	ID    string `json:"id"`
	Alias string `json:"alias"`
}

// AudioDTO 分发音频视图，含对外可访问地址。
type AudioDTO struct {
	ID           string   `json:"id"`
	QualityLabel string   `json:"qualityLabel"`
	Format       string   `json:"format"`
	Bitrate      int      `json:"bitrate"`
	SamplingRate int      `json:"samplingRate"`
	BitDepth     int      `json:"bitDepth"`
	ChannelCount int      `json:"channelCount"`
	Duration     int      `json:"duration"`
	Size         int64    `json:"size"`
	Loudness     *float64 `json:"loudness,omitempty"`
	URL          string   `json:"url"`
}

// OriginDTO 原始音频视图（管理端可见）。
type OriginDTO struct {
	ID           string    `json:"id"`
	FileKey      string    `json:"fileKey"`
	Hash         string    `json:"hash"`
	Format       string    `json:"format"`
	Encoder      string    `json:"encoder"`
	Status       string    `json:"status"`
	Size         int64     `json:"size"`
	Duration     int       `json:"duration"`
	Bitrate      int       `json:"bitrate"`
	SamplingRate int       `json:"samplingRate"`
	BitDepth     int       `json:"bitDepth"`
	ChannelCount int       `json:"channelCount"`
	URL          string    `json:"url"`
	CreatedAt    time.Time `json:"createdAt"`
}

// TrackDTO 曲目完整视图。
type TrackDTO struct {
	ID        string        `json:"id"`
	Title     string        `json:"title"`
	Duration  int           `json:"duration"`
	Available bool          `json:"available"`
	CoverURL  string        `json:"coverUrl,omitempty"`
	LiveID    string        `json:"liveId,omitempty"`
	Aliases   []string      `json:"aliases"`
	Artists   []ArtistDTO   `json:"artists"`
	Albums    []AlbumDTO    `json:"albums,omitempty"`
	Languages []LanguageDTO `json:"languages,omitempty"`
	Lyric     string        `json:"lyric,omitempty"`
	LRCLyric  string        `json:"lrcLyric,omitempty"`
	Audios    []AudioDTO    `json:"audios,omitempty"`
	Origins   []OriginDTO   `json:"origins,omitempty"`
	AliasRows []AliasRow    `json:"aliasRows,omitempty"`
}

func itoa(i int64) string { return strconv.FormatInt(i, 10) }

// loadArtistsForTracks 批量加载多个曲目的艺术家，避免 N+1。
func loadArtistsForTracks(db *gorm.DB, trackIDs []int64) map[int64][]ArtistDTO {
	out := make(map[int64][]ArtistDTO)
	if len(trackIDs) == 0 {
		return out
	}
	var rows []struct {
		TrackID int64
		ID      int64
		Name    string
	}
	db.Table("track_artists ta").
		Select("ta.track_id AS track_id, a.id AS id, a.name AS name").
		Joins("JOIN artist a ON a.id = ta.artist_id").
		Where("ta.track_id IN ?", trackIDs).
		Order("ta.position ASC").
		Scan(&rows)
	for _, r := range rows {
		out[r.TrackID] = append(out[r.TrackID], ArtistDTO{ID: itoa(r.ID), Name: r.Name})
	}
	return out
}

// buildTrackDTO 构建单个曲目的完整 DTO（别名/艺术家/专辑/语种，可选音频）。
func buildTrackDTO(db *gorm.DB, store *objectstore.Store, t *model.Track, includeAudio bool) TrackDTO {
	dto := TrackDTO{
		ID:        itoa(t.ID),
		Title:     t.Title,
		Duration:  t.Duration,
		Available: t.Available,
		Aliases:   []string{},
		Artists:   []ArtistDTO{},
	}
	if t.CoverKey != nil {
		dto.CoverURL = store.PublicURL(*t.CoverKey)
	}
	if t.LiveID != nil {
		dto.LiveID = itoa(*t.LiveID)
	}
	if t.Lyric != nil {
		dto.Lyric = *t.Lyric
	}
	if t.LRCLyric != nil {
		dto.LRCLyric = *t.LRCLyric
	}

	var aliases []model.TrackAlias
	db.Where("track_id = ?", t.ID).Order("alias ASC").Find(&aliases)
	for _, a := range aliases {
		dto.Aliases = append(dto.Aliases, a.Alias)
	}

	if artists := loadArtistsForTracks(db, []int64{t.ID})[t.ID]; len(artists) > 0 {
		dto.Artists = artists
	}

	var albums []struct {
		ID       int64
		Title    string
		CoverKey *string
	}
	db.Table("track_albums ta").
		Select("al.id, al.title, al.cover_key").
		Joins("JOIN album al ON al.id = ta.album_id").
		Where("ta.track_id = ?", t.ID).
		Scan(&albums)
	for _, al := range albums {
		a := AlbumDTO{ID: itoa(al.ID), Title: al.Title}
		if al.CoverKey != nil {
			a.CoverURL = store.PublicURL(*al.CoverKey)
		}
		dto.Albums = append(dto.Albums, a)
	}

	var langs []struct {
		ID   int
		Name string
	}
	db.Table("track_languages tl").
		Select("l.id, l.name").
		Joins("JOIN language l ON l.id = tl.language_id").
		Where("tl.track_id = ?", t.ID).
		Scan(&langs)
	for _, l := range langs {
		dto.Languages = append(dto.Languages, LanguageDTO{ID: l.ID, Name: l.Name})
	}

	if includeAudio {
		var audios []model.Audio
		db.Where("track_id = ?", t.ID).Order("bitrate DESC").Find(&audios)
		for _, au := range audios {
			dto.Audios = append(dto.Audios, AudioDTO{
				ID:           itoa(au.ID),
				QualityLabel: au.QualityLabel,
				Format:       au.Format,
				Bitrate:      au.Bitrate,
				SamplingRate: au.SamplingRate,
				BitDepth:     au.BitDepth,
				ChannelCount: au.ChannelCount,
				Duration:     au.Duration,
				Size:         au.Size,
				Loudness:     au.Loudness,
				URL:          store.PublicURL(au.FileKey),
			})
		}
	}
	return dto
}

// buildOrigins 构建某曲目的原始音频列表（管理端）。
func buildOrigins(db *gorm.DB, store *objectstore.Store, trackID int64) []OriginDTO {
	var origins []model.OriginAudio
	db.Where("track_id = ?", trackID).Order("created_at DESC").Find(&origins)
	out := make([]OriginDTO, 0, len(origins))
	for _, o := range origins {
		out = append(out, OriginDTO{
			ID:           itoa(o.ID),
			FileKey:      o.FileKey,
			Hash:         o.Hash,
			Format:       o.Format,
			Encoder:      o.Encoder,
			Status:       o.Status,
			Size:         o.Size,
			Duration:     o.Duration,
			Bitrate:      o.Bitrate,
			SamplingRate: o.SamplingRate,
			BitDepth:     o.BitDepth,
			ChannelCount: o.ChannelCount,
			URL:          store.PublicURL(o.FileKey),
			CreatedAt:    o.CreatedAt,
		})
	}
	return out
}
