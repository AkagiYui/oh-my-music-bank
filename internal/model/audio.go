package model

// 原始音频处理状态。
const (
	OriginStatusPending    = "pending"
	OriginStatusProcessing = "processing"
	OriginStatusReady      = "ready"
	OriginStatusFailed     = "failed"
)

// OriginAudio 原始音频，管理员上传的源文件。
type OriginAudio struct {
	BigIDBase
	TrackID      int64   `gorm:"column:track_id"      json:"trackId,string"`
	Size         int64   `json:"size"`
	FileKey      string  `gorm:"column:file_key"      json:"fileKey"`
	Hash         string  `json:"hash"` // 文件 SHA-256（hex），全局去重
	Duration     int     `json:"duration"`
	Bitrate      int     `json:"bitrate"`
	ChannelCount int     `gorm:"column:channel_count" json:"channelCount"`
	SamplingRate int     `gorm:"column:sampling_rate" json:"samplingRate"`
	BitDepth     int     `gorm:"column:bit_depth"     json:"bitDepth"`
	Format       string  `json:"format"`
	Encoder      string  `json:"encoder"`
	Status       string  `json:"status"`
	ErrorMessage *string `gorm:"column:error_message" json:"errorMessage"`
}

// TableName 返回原始音频表名。
func (OriginAudio) TableName() string { return "origin_audio" }

// Audio 用于分发的音频，一首歌每个音质档位一行。
type Audio struct {
	BigIDBase
	TrackID      int64    `gorm:"column:track_id"      json:"trackId,string"`
	Size         int64    `json:"size"`
	FileKey      string   `gorm:"column:file_key"      json:"fileKey"`
	Hash         string   `json:"hash"`
	Duration     int      `json:"duration"`
	Bitrate      int      `json:"bitrate"`
	ChannelCount int      `gorm:"column:channel_count" json:"channelCount"`
	SamplingRate int      `gorm:"column:sampling_rate" json:"samplingRate"`
	BitDepth     int      `gorm:"column:bit_depth"     json:"bitDepth"`
	Format       string   `json:"format"`
	Encoder      string   `json:"encoder"`
	HasLyric     bool     `gorm:"column:has_lyric"     json:"hasLyric"`
	HasCover     bool     `gorm:"column:has_cover"     json:"hasCover"`
	Loudness     *float64 `gorm:"column:loudness"      json:"loudness"` // 集成响度 LUFS
	QualityLabel string   `gorm:"column:quality_label" json:"qualityLabel"`
	IsDirty      bool     `gorm:"column:is_dirty"      json:"isDirty"`
	Source       *string  `json:"source"`
}

// TableName 返回分发音频表名。
func (Audio) TableName() string { return "audio" }
