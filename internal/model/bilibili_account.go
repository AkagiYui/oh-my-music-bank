package model

import "time"

// BilibiliAccount 是站点管理员共享的导入账号；凭据永不进入 JSON 响应。
type BilibiliAccount struct {
	ID                  string     `gorm:"primaryKey" json:"id"`
	MID                 *string    `gorm:"column:mid" json:"mid"`
	Name                string     `json:"name"`
	Avatar              string     `json:"avatar"`
	Cookie              string     `json:"-"`
	RefreshToken        string     `json:"-"`
	PendingRefreshToken string     `json:"-"`
	IsDefault           bool       `json:"isDefault"`
	Status              string     `json:"status"`
	LastCheckedAt       *time.Time `json:"lastCheckedAt"`
	LastRefreshedAt     *time.Time `json:"lastRefreshedAt"`
	CreatedAt           time.Time  `json:"createdAt"`
	UpdatedAt           time.Time  `json:"updatedAt"`
}

func (BilibiliAccount) TableName() string { return "bilibili_account" }

// BilibiliLogin 将二维码绑定到发起登录的站点用户，防止跨用户轮询和重复保存。
type BilibiliLogin struct {
	ID         string `gorm:"primaryKey"`
	UserID     string
	QRKey      string
	AccountID  *string
	ExpiresAt  time.Time
	LastPollAt *time.Time
}

func (BilibiliLogin) TableName() string { return "bilibili_login" }
