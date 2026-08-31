package objectgc

import (
	"context"
	"github.com/akagiyui/oh-my-music-bank/internal/model"
	"github.com/akagiyui/oh-my-music-bank/internal/storage/objectstore"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"time"
)

func Schedule(db *gorm.DB, key string, delay time.Duration) error {
	if key == "" {
		return nil
	}
	return db.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "file_key"}}, DoUpdates: clause.AssignmentColumns([]string{"not_before"})}).Create(&model.ObjectGC{FileKey: key, NotBefore: time.Now().Add(delay)}).Error
}

// 先持久化清理意图，再写对象；崩溃不会留下永远无法追踪的临时对象。
func Collect(ctx context.Context, db *gorm.DB, store *objectstore.Store) error {
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var rows []model.ObjectGC
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).Where("not_before <= now()").Limit(20).Find(&rows).Error; err != nil {
			return err
		}
		for _, r := range rows {
			var refs int64
			if err := tx.Raw(`SELECT (SELECT count(*) FROM origin_audio WHERE file_key=@key)+(SELECT count(*) FROM audio WHERE file_key=@key)+(SELECT count(*) FROM track WHERE cover_key=@key)+(SELECT count(*) FROM artist WHERE avatar_key=@key)+(SELECT count(*) FROM album WHERE cover_key=@key)+(SELECT count(*) FROM ingest_job WHERE input_key=@key AND (status IN ('queued','processing') OR created_at > now()-interval '7 days'))`, map[string]any{"key": r.FileKey}).Scan(&refs).Error; err != nil {
				return err
			}
			if refs > 0 {
				if err := tx.Model(&r).Update("not_before", time.Now().Add(24*time.Hour)).Error; err != nil {
					return err
				}
				continue
			}
			if err := store.Remove(ctx, r.FileKey); err != nil {
				if e := tx.Model(&r).Updates(map[string]any{"attempts": r.Attempts + 1, "not_before": time.Now().Add(time.Hour)}).Error; e != nil {
					return e
				}
				continue
			}
			if err := tx.Delete(&r).Error; err != nil {
				return err
			}
		}
		return nil
	})
}
