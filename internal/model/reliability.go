package model

import "time"

// AuthSession 保存可撤销会话，刷新凭据只保存摘要。
type AuthSession struct {
	ID          string `gorm:"primaryKey"`
	UserID      string
	RefreshHash string
	ExpiresAt   time.Time
	CreatedAt   time.Time
}

func (AuthSession) TableName() string { return "auth_session" }

type ObjectGC struct {
	BucketKind string `gorm:"primaryKey;column:bucket_kind"`
	FileKey    string `gorm:"primaryKey"`
	NotBefore  time.Time
	Attempts   int
	LeaseUntil *time.Time
}

func (ObjectGC) TableName() string { return "object_gc" }

type IngestJob struct {
	ID              string     `gorm:"primaryKey" json:"id"`
	UserID          string     `json:"userId"`
	Kind            string     `json:"kind"`
	Payload         string     `json:"-"`
	InputKey        string     `json:"-"`
	Status          string     `json:"status"`
	Progress        int        `json:"progress"`
	Stage           string     `json:"stage"`
	ErrorMessage    string     `json:"errorMessage"`
	TrackID         *int64     `json:"trackId,string,omitempty"`
	Deduplicated    bool       `json:"deduplicated"`
	Attempts        int        `json:"attempts"`
	CancelRequested bool       `json:"cancelRequested"`
	RunID           *string    `json:"-"`
	LeaseUntil      *time.Time `json:"-"`
	CreatedAt       time.Time  `json:"createdAt"`
	UpdatedAt       time.Time  `json:"updatedAt"`
}

func (IngestJob) TableName() string { return "ingest_job" }
