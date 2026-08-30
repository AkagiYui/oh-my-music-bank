// Package model 定义数据库持久化模型。
//
// 约定（见 AGENTS.md）：GORM tag 仅承载运行时 ORM 映射
// （column / primaryKey / foreignKey / autoCreateTime / autoUpdateTime / -），
// 不在 tag 中维护 type / not null / default / index 等 schema 定义——
// 这些由 internal/storage/db/migrations 下的 goose SQL 维护。
package model

import "time"

// Base UUID 主键 + 时间戳基类（用于用户、API Key 等表）。
type Base struct {
	ID        string    `gorm:"primaryKey;default:(-)" json:"id"`
	CreatedAt time.Time `gorm:"autoCreateTime"         json:"createdAt"`
	UpdatedAt time.Time `gorm:"autoUpdateTime"         json:"updatedAt"`
}

// BigIDBase bigint 主键 + 时间戳基类（用于目录实体）。
//
// 曲目/艺术家的 ID 由应用层雪花生成器分配；专辑/演唱会/音频等留 0，
// 由数据库 serial 自增生成。ID 以字符串序列化，避免前端 JS 大整数精度丢失。
type BigIDBase struct {
	ID        int64     `gorm:"primaryKey"     json:"id,string"`
	CreatedAt time.Time `gorm:"autoCreateTime" json:"createdAt"`
	UpdatedAt time.Time `gorm:"autoUpdateTime" json:"updatedAt"`
}
