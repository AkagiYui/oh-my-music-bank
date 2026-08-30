package model

import "time"

// Artist 艺术家。
type Artist struct {
	BigIDBase
	Name      string  `json:"name"`
	AvatarKey *string `gorm:"column:avatar_key" json:"avatarKey"`
}

// TableName 返回艺术家表名。
func (Artist) TableName() string { return "artist" }

// ArtistAlias 艺术家别名。
type ArtistAlias struct {
	ID       int64  `gorm:"primaryKey"       json:"id,string"`
	ArtistID int64  `gorm:"column:artist_id" json:"artistId,string"`
	Alias    string `json:"alias"`
}

// TableName 返回艺术家别名表名。
func (ArtistAlias) TableName() string { return "artist_aliases" }

// ArtistAlbum 艺术家-专辑关联。
type ArtistAlbum struct {
	ID       int64 `gorm:"primaryKey"       json:"id,string"`
	ArtistID int64 `gorm:"column:artist_id" json:"artistId,string"`
	AlbumID  int64 `gorm:"column:album_id"  json:"albumId,string"`
}

// TableName 返回艺术家-专辑关联表名。
func (ArtistAlbum) TableName() string { return "artist_albums" }

// Album 专辑。
type Album struct {
	BigIDBase
	Title    string  `json:"title"`
	CoverKey *string `gorm:"column:cover_key" json:"coverKey"`
}

// TableName 返回专辑表名。
func (Album) TableName() string { return "album" }

// Language 语种。
type Language struct {
	ID   int    `gorm:"primaryKey" json:"id"`
	Name string `json:"name"`
}

// TableName 返回语种表名。
func (Language) TableName() string { return "language" }

// Live 演唱会。
type Live struct {
	BigIDBase
	Title string    `json:"title"`
	Time  time.Time `json:"time"`
}

// TableName 返回演唱会表名。
func (Live) TableName() string { return "live" }

// LiveArtist 演唱会-艺术家关联。
type LiveArtist struct {
	ID       int64   `gorm:"primaryKey"       json:"id,string"`
	LiveID   int64   `gorm:"column:live_id"   json:"liveId,string"`
	ArtistID int64   `gorm:"column:artist_id" json:"artistId,string"`
	Role     *string `json:"role"`
}

// TableName 返回演唱会-艺术家关联表名。
func (LiveArtist) TableName() string { return "live_artists" }
