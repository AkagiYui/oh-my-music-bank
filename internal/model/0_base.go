// Package model 定义数据库持久化模型。
//
// 约定（见 AGENTS.md）：GORM tag 仅承载运行时 ORM 映射
// （column / primaryKey / foreignKey / autoCreateTime / autoUpdateTime / -），
// 不在 tag 中维护 type / not null / default / index 等 schema 定义——
// 这些由 internal/storage/db/migrations 下的 goose SQL 维护。
package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Base UUID 主键 + 时间戳基类（用于用户、API Key、媒体资源等表）。
type Base struct {
	ID        string    `gorm:"primaryKey"             json:"id"`
	CreatedAt time.Time `gorm:"autoCreateTime"         json:"createdAt"`
	UpdatedAt time.Time `gorm:"autoUpdateTime"         json:"updatedAt"`
}

// BeforeCreate 在应用侧生成按时间可排序的 UUIDv7，数据库默认值仅作为外部写入兜底。
func (b *Base) BeforeCreate(_ *gorm.DB) error {
	if b.ID != "" {
		return nil
	}
	id, err := uuid.NewV7()
	if err != nil {
		return err
	}
	b.ID = id.String()
	return nil
}

// BigIDBase bigint 主键 + 时间戳基类（用于目录实体）。
//
// 曲目/艺术家的 ID 由应用层雪花生成器分配；专辑/演唱会等留 0，
// 由数据库 serial 自增生成。ID 以字符串序列化，避免前端 JS 大整数精度丢失。
type BigIDBase struct {
	ID        int64     `gorm:"primaryKey"     json:"id,string"`
	CreatedAt time.Time `gorm:"autoCreateTime" json:"createdAt"`
	UpdatedAt time.Time `gorm:"autoUpdateTime" json:"updatedAt"`
}
