package objectgc

import (
	"context"
	"errors"
	"time"

	"github.com/akagiyui/oh-my-music-bank/internal/model"
	"github.com/akagiyui/oh-my-music-bank/internal/storage/objectstore"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func Schedule(db *gorm.DB, bucket objectstore.BucketKind, key string, delay time.Duration) error {
	if key == "" {
		return nil
	}
	return db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "bucket_kind"}, {Name: "file_key"}},
		DoUpdates: clause.Assignments(map[string]any{
			"not_before":  time.Now().Add(delay),
			"lease_until": nil,
		}),
	}).Create(&model.ObjectGC{BucketKind: string(bucket), FileKey: key, NotBefore: time.Now().Add(delay)}).Error
}

// Collect 先在短事务内领取任务，再在事务外调用对象存储，避免慢网络请求长期占用数据库锁。
func Collect(ctx context.Context, db *gorm.DB, store *objectstore.Store) error {
	leaseUntil := time.Now().Add(5 * time.Minute)
	var rows []model.ObjectGC
	if err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).
			Where("not_before <= now() AND (lease_until IS NULL OR lease_until <= now())").
			Limit(20).Find(&rows).Error; err != nil {
			return err
		}
		for _, r := range rows {
			if err := tx.Model(&model.ObjectGC{}).
				Where("bucket_kind = ? AND file_key = ?", r.BucketKind, r.FileKey).
				Updates(map[string]any{"lease_until": leaseUntil, "attempts": gorm.Expr("attempts + 1")}).Error; err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		return err
	}

	var result error
	for _, r := range rows {
		refs, err := referenceCount(ctx, db, r)
		if err != nil {
			result = errors.Join(result, err, postpone(ctx, db, r, time.Hour))
			continue
		}
		if refs > 0 {
			result = errors.Join(result, postpone(ctx, db, r, 24*time.Hour))
			continue
		}
		if err := store.Remove(ctx, objectstore.BucketKind(r.BucketKind), r.FileKey); err != nil {
			result = errors.Join(result, err, postpone(ctx, db, r, time.Hour))
			continue
		}
		result = errors.Join(result, db.WithContext(ctx).
			Where("bucket_kind = ? AND file_key = ? AND lease_until = ?", r.BucketKind, r.FileKey, leaseUntil).
			Delete(&model.ObjectGC{}).Error)
	}
	return result
}

func referenceCount(ctx context.Context, db *gorm.DB, row model.ObjectGC) (int64, error) {
	query := `SELECT (SELECT count(*) FROM track WHERE cover_key=@key)+
        (SELECT count(*) FROM artist WHERE avatar_key=@key)+
        (SELECT count(*) FROM album WHERE cover_key=@key)`
	if objectstore.BucketKind(row.BucketKind) == objectstore.BucketPrivate {
		query = `SELECT (SELECT count(*) FROM origin_audio WHERE file_key=@key)+
            (SELECT count(*) FROM audio WHERE file_key=@key)+
            (SELECT count(*) FROM ingest_job WHERE input_key=@key AND
                (status IN ('queued','processing') OR created_at > now()-interval '7 days'))`
	}
	var refs int64
	err := db.WithContext(ctx).Raw(query, map[string]any{"key": row.FileKey}).Scan(&refs).Error
	return refs, err
}

func postpone(ctx context.Context, db *gorm.DB, row model.ObjectGC, delay time.Duration) error {
	return db.WithContext(ctx).Model(&model.ObjectGC{}).
		Where("bucket_kind = ? AND file_key = ?", row.BucketKind, row.FileKey).
		Updates(map[string]any{"not_before": time.Now().Add(delay), "lease_until": nil}).Error
}
