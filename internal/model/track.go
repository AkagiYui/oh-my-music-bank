package model

// Track 歌曲。
type Track struct {
	BigIDBase
	Title     string  `json:"title"`
	Duration  int     `json:"duration"` // 时长（秒），展示用
	Lyric     *string `json:"lyric"`
	LRCLyric  *string `gorm:"column:lrc_lyric" json:"lrcLyric"`
	CoverKey  *string `gorm:"column:cover_key" json:"coverKey"`
	Available bool    `json:"available"`
	LiveID    *int64  `gorm:"column:live_id"   json:"liveId"`
}

// TableName 返回曲目表名。
func (Track) TableName() string { return "track" }

// TrackAlias 歌曲别名。
type TrackAlias struct {
	ID      int64  `gorm:"primaryKey"     json:"id,string"`
	TrackID int64  `gorm:"column:track_id" json:"trackId,string"`
	Alias   string `json:"alias"`
}

// TableName 返回曲目别名表名。
func (TrackAlias) TableName() string { return "track_aliases" }

// TrackArtist 歌曲-艺术家关联。position 为展示顺序，0 表示主唱。
type TrackArtist struct {
	ID       int64 `gorm:"primaryKey"       json:"id,string"`
	TrackID  int64 `gorm:"column:track_id"  json:"trackId,string"`
	ArtistID int64 `gorm:"column:artist_id" json:"artistId,string"`
	Position int   `json:"position"`
}

// TableName 返回曲目-艺术家关联表名。
func (TrackArtist) TableName() string { return "track_artists" }

// TrackAlbum 歌曲-专辑关联。
type TrackAlbum struct {
	ID      int64 `gorm:"primaryKey"      json:"id,string"`
	TrackID int64 `gorm:"column:track_id" json:"trackId,string"`
	AlbumID int64 `gorm:"column:album_id" json:"albumId,string"`
	TrackNo *int  `gorm:"column:track_no" json:"trackNo"`
	DiscNo  *int  `gorm:"column:disc_no"  json:"discNo"`
}

// TableName 返回曲目-专辑关联表名。
func (TrackAlbum) TableName() string { return "track_albums" }

// TrackLanguage 歌曲-语种关联。
type TrackLanguage struct {
	ID         int64 `gorm:"primaryKey"         json:"id,string"`
	TrackID    int64 `gorm:"column:track_id"    json:"trackId,string"`
	LanguageID int   `gorm:"column:language_id" json:"languageId"`
}

// TableName 返回曲目-语种关联表名。
func (TrackLanguage) TableName() string { return "track_languages" }
