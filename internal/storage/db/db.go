// Package db 负责初始化数据库连接并执行版本化迁移。
package db

import (
	"context"
	"embed"
	"time"

	goose "github.com/pressly/goose/v3"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// migrationsFS 将 SQL 迁移文件打进二进制，容器运行时无需额外 goose CLI。
//
//go:embed migrations/*.sql
var migrationsFS embed.FS

// Init 初始化 GORM（PostgreSQL）连接并配置连接池。
func Init(dsn string, maxOpenConns, maxIdleConns, maxLifetimeSecs, maxIdleTimeSecs int) (*gorm.DB, error) {
	gormLogger := logger.Default.LogMode(logger.Warn)

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: gormLogger,
	})
	if err != nil {
		return nil, err
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}

	if maxOpenConns > 0 {
		sqlDB.SetMaxOpenConns(maxOpenConns)
	}
	if maxIdleConns > 0 {
		sqlDB.SetMaxIdleConns(maxIdleConns)
	}
	if maxLifetimeSecs > 0 {
		sqlDB.SetConnMaxLifetime(time.Duration(maxLifetimeSecs) * time.Second)
	}
	if maxIdleTimeSecs > 0 {
		sqlDB.SetConnMaxIdleTime(time.Duration(maxIdleTimeSecs) * time.Second)
	}

	return db, nil
}

// Migrate 执行所有尚未应用的 goose SQL 迁移。
func Migrate(db *gorm.DB) error {
	sqlDB, err := db.DB()
	if err != nil {
		return err
	}

	goose.SetBaseFS(migrationsFS)
	if err := goose.SetDialect("postgres"); err != nil {
		return err
	}

	// 数据库级 advisory lock，避免多实例启动时并发执行迁移。
	// 锁连接独立占用一个连接，避免单连接配置下迁移等待自身。
	maxOpen := sqlDB.Stats().MaxOpenConnections
	if maxOpen > 0 {
		sqlDB.SetMaxOpenConns(maxOpen + 1)
		defer sqlDB.SetMaxOpenConns(maxOpen)
	}
	conn, err := sqlDB.Conn(context.Background())
	if err != nil {
		return err
	}
	defer conn.Close()
	if _, err := conn.ExecContext(context.Background(), "SELECT pg_advisory_lock(91120001)"); err != nil {
		return err
	}
	defer conn.ExecContext(context.Background(), "SELECT pg_advisory_unlock(91120001)")

	return goose.Up(sqlDB, "migrations")
}
