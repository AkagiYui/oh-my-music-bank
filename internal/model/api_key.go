package model

import "time"

// APIKey API 密钥。出于安全只存哈希，明文仅在创建时返回一次。
type APIKey struct {
	Base
	UserID      string     `gorm:"column:user_id"      json:"userId"`
	Name        string     `json:"name"`
	KeyHash     string     `gorm:"column:key_hash"     json:"-"`         // 密钥 SHA-256（hex）
	KeyPrefix   string     `gorm:"column:key_prefix"   json:"keyPrefix"` // 前缀，可公开展示
	Description string     `json:"description"`
	RPMOverride *int       `gorm:"column:rpm_override" json:"rpmOverride"`
	ExpiresAt   *time.Time `gorm:"column:expires_at"   json:"expiresAt"`
	LastUsedAt  *time.Time `gorm:"column:last_used_at" json:"lastUsedAt"`
	IsRevoked   bool       `gorm:"column:is_revoked"   json:"isRevoked"`
}

// TableName 返回 API 密钥表名。
func (APIKey) TableName() string { return "api_key" }

// APIRequestLog API 调用日志，用于审计与用量统计。
type APIRequestLog struct {
	ID         int64     `gorm:"primaryKey"          json:"id,string"`
	CreatedAt  time.Time `gorm:"autoCreateTime"      json:"createdAt"`
	APIKeyID   *string   `gorm:"column:api_key_id"   json:"apiKeyId"`
	UserID     *string   `gorm:"column:user_id"      json:"userId"`
	Path       string    `json:"path"`
	TrackID    *int64    `gorm:"column:track_id"     json:"trackId"`
	StatusCode int       `gorm:"column:status_code"  json:"statusCode"`
	LatencyMs  int       `gorm:"column:latency_ms"   json:"latencyMs"`
	ClientIP   string    `gorm:"column:client_ip"    json:"clientIp"`
}

// TableName 返回调用日志表名。
func (APIRequestLog) TableName() string { return "api_request_log" }

// Setting 运行时键值设置。
type Setting struct {
	Key   string `gorm:"column:key;primaryKey" json:"key"`
	Value string `gorm:"column:value"          json:"value"`
}

// TableName 返回设置表名。
func (Setting) TableName() string { return "settings" }
