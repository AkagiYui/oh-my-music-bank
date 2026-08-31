package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/akagiyui/oh-my-music-bank/internal/middleware"
	"github.com/akagiyui/oh-my-music-bank/internal/model"
	"github.com/akagiyui/oh-my-music-bank/internal/service/objectgc"
	"github.com/akagiyui/oh-my-music-bank/internal/storage/objectstore"
	pkgerrors "github.com/akagiyui/oh-my-music-bank/pkg/errors"
	"github.com/akagiyui/oh-my-music-bank/pkg/response"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Jobs struct {
	db       *gorm.DB
	store    *objectstore.Store
	bili     *BilibiliHandler
	maxBytes int64
	cancel   context.CancelFunc
	wg       sync.WaitGroup
}
type uploadPayload struct {
	Filename string `json:"filename"`
	Title    string `json:"title"`
	Artist   string `json:"artist"`
	Ext      string `json:"ext"`
	TrackID  string `json:"trackId"`
}
type jobRun struct {
	ID    string
	RunID string
}
type jobContextKey struct{}

func optionalTrackID(raw string) (int64, error) {
	if raw == "" {
		return 0, nil
	}
	id, e := strconv.ParseInt(raw, 10, 64)
	if e != nil || id <= 0 {
		return 0, fmt.Errorf("invalid trackId")
	}
	return id, nil
}
func NewJobs(db *gorm.DB, store *objectstore.Store, bili *BilibiliHandler, maxBytes int64) *Jobs {
	return &Jobs{db: db, store: store, bili: bili, maxBytes: maxBytes}
}
func (j *Jobs) Start() {
	ctx, cancel := context.WithCancel(context.Background())
	j.cancel = cancel
	for i := 0; i < 2; i++ {
		j.wg.Add(1)
		go func() {
			defer j.wg.Done()
			t := time.NewTicker(time.Second)
			defer t.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-t.C:
					j.process(ctx)
				}
			}
		}()
	}
	j.wg.Add(1)
	go func() {
		defer j.wg.Done()
		t := time.NewTicker(time.Minute)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				cleanup, cancel := context.WithTimeout(ctx, 30*time.Second)
				if err := objectgc.Collect(cleanup, j.db, j.store); err != nil {
					log.Printf("object cleanup: %v", err)
				}
				j.db.WithContext(cleanup).Where("expires_at < now()").Delete(&model.AuthSession{})
				j.db.WithContext(cleanup).Exec("DELETE FROM request_budget WHERE window_start < now()-interval '1 hour'")
				// 审计日志保留期由管理员显式配置；默认不自动删除历史。
				days, _ := strconv.Atoi(j.bili.cache.GetSetting("logs.retention_days"))
				if days > 0 {
					j.db.WithContext(cleanup).Exec("DELETE FROM api_request_log WHERE created_at < now() - (? * interval '1 day')", days)
				}
				cancel()
			}
		}
	}()
}
func (j *Jobs) Stop() {
	if j.cancel != nil {
		j.cancel()
		j.wg.Wait()
	}
}
func (j *Jobs) List(c *gin.Context) {
	page, size, offset := parsePagination(c)
	var rows []model.IngestJob
	var total int64
	q := j.db.Model(&model.IngestJob{})
	if err := q.Count(&total).Error; err != nil {
		c.JSON(500, pkgerrors.Internal("读取任务失败"))
		return
	}
	if err := q.Order("created_at DESC").Limit(size).Offset(offset).Find(&rows).Error; err != nil {
		c.JSON(500, pkgerrors.Internal("读取任务失败"))
		return
	}
	response.Paginated(c, rows, total, page, size)
}
func (j *Jobs) Upload(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, j.maxBytes+(1<<20))
	f, err := c.FormFile("file")
	if err != nil {
		c.JSON(400, pkgerrors.BadRequest("文件无效或超过大小限制"))
		return
	}
	if f.Size > j.maxBytes || f.Size == 0 {
		c.JSON(413, pkgerrors.BadRequest("文件大小超出限制"))
		return
	}
	target, err := optionalTrackID(c.PostForm("trackId"))
	if err != nil {
		c.JSON(400, pkgerrors.BadRequest(err.Error()))
		return
	}
	if target != 0 {
		var t model.Track
		if j.db.First(&t, target).Error != nil {
			c.JSON(404, pkgerrors.NotFound("目标曲目不存在"))
			return
		}
	}
	ext := strings.ToLower(filepath.Ext(f.Filename))
	switch ext {
	case ".mp3", ".m4a", ".mp4", ".flac", ".wav", ".ogg", ".opus", ".aac", ".aiff", ".ape":
	default:
		c.JSON(400, pkgerrors.BadRequest("不支持的音频扩展名"))
		return
	}
	src, err := f.Open()
	if err != nil {
		c.JSON(400, pkgerrors.BadRequest("读取文件失败"))
		return
	}
	defer src.Close()
	key := "staging/" + uuid.NewString() + ext
	if err = objectgc.Schedule(j.db, key, 24*time.Hour); err == nil {
		err = j.store.Put(c.Request.Context(), key, src, f.Size, "application/octet-stream")
	}
	if err != nil {
		c.JSON(502, pkgerrors.Internal("保存上传文件失败"))
		return
	}
	payload, _ := json.Marshal(uploadPayload{Filename: f.Filename, Title: c.PostForm("title"), Artist: c.PostForm("artist"), Ext: ext, TrackID: c.PostForm("trackId")})
	job := model.IngestJob{ID: uuid.NewString(), UserID: c.GetString(middleware.CtxUserID), Kind: "upload", Payload: string(payload), InputKey: key, Status: "queued", Stage: "等待处理"}
	if err = j.db.Create(&job).Error; err != nil {
		c.JSON(500, pkgerrors.Internal("创建任务失败"))
		return
	}
	c.JSON(202, gin.H{"data": job})
}
func (j *Jobs) Bilibili(c *gin.Context) {
	var req struct {
		Items []BiliIngestRequest `json:"items"`
	}
	if c.ShouldBindJSON(&req) != nil || len(req.Items) == 0 || len(req.Items) > 50 {
		c.JSON(400, pkgerrors.BadRequest("每次提交 1 至 50 个任务"))
		return
	}
	rows := make([]model.IngestJob, 0, len(req.Items))
	for _, r := range req.Items {
		if r.Bvid == "" || r.Cid <= 0 {
			c.JSON(400, pkgerrors.BadRequest("bvid/cid required"))
			return
		}
		if _, err := optionalTrackID(r.TrackID); err != nil {
			c.JSON(400, pkgerrors.BadRequest(err.Error()))
			return
		}
		b, _ := json.Marshal(r)
		rows = append(rows, model.IngestJob{ID: uuid.NewString(), UserID: c.GetString(middleware.CtxUserID), Kind: "bilibili", Payload: string(b), Status: "queued", Stage: "等待处理"})
	}
	if err := j.db.Create(&rows).Error; err != nil {
		c.JSON(500, pkgerrors.Internal("创建任务失败"))
		return
	}
	c.JSON(202, gin.H{"data": rows})
}
func (j *Jobs) Cancel(c *gin.Context) {
	r := j.db.Model(&model.IngestJob{}).Where("id = ? AND status IN ('queued','processing')", c.Param("id")).Updates(map[string]any{"cancel_requested": true, "status": gorm.Expr("CASE WHEN status='queued' THEN 'cancelled' ELSE status END"), "stage": "已请求取消"})
	if r.Error != nil {
		c.JSON(500, pkgerrors.Internal("取消失败"))
		return
	}
	if r.RowsAffected == 0 {
		c.JSON(409, pkgerrors.Conflict("任务已结束"))
		return
	}
	response.NoContent(c)
}
func (j *Jobs) Retry(c *gin.Context) {
	r := j.db.Model(&model.IngestJob{}).Where("id = ? AND status IN ('failed','cancelled') AND created_at > now()-interval '7 days'", c.Param("id")).Updates(map[string]any{"status": "queued", "stage": "等待重试", "progress": 0, "error_message": "", "cancel_requested": false, "run_id": nil})
	if r.Error != nil {
		c.JSON(500, pkgerrors.Internal("重试失败"))
		return
	}
	if r.RowsAffected == 0 {
		c.JSON(409, pkgerrors.Conflict("任务不可重试，上传文件仅保留七天"))
		return
	}
	response.NoContent(c)
}
func (j *Jobs) process(parent context.Context) {
	var job model.IngestJob
	err := j.db.WithContext(parent).Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).Where("status='queued' OR (status='processing' AND lease_until < now())").Order("created_at").First(&job).Error; err != nil {
			return err
		}
		if job.CancelRequested {
			job.RunID = nil
			return tx.Model(&job).Updates(map[string]any{"status": "cancelled", "stage": "已取消"}).Error
		}
		run := uuid.NewString()
		job.RunID = &run
		return tx.Model(&job).Updates(map[string]any{"status": "processing", "stage": "下载与解析音频", "progress": 10, "attempts": job.Attempts + 1, "lease_until": time.Now().Add(time.Minute), "run_id": run}).Error
	})
	if err != nil || job.RunID == nil {
		return
	}
	ctx, cancel := context.WithTimeout(parent, 30*time.Minute)
	defer cancel()
	ctx = context.WithValue(ctx, jobContextKey{}, jobRun{ID: job.ID, RunID: *job.RunID})
	done := make(chan struct{})
	heartbeatDone := make(chan struct{})
	go func() {
		defer close(heartbeatDone)
		tick := time.NewTicker(2 * time.Second)
		defer tick.Stop()
		for {
			select {
			case <-done:
				return
			case <-ctx.Done():
				return
			case <-tick.C:
				var current model.IngestJob
				if j.db.WithContext(ctx).Where("id = ? AND run_id = ?", job.ID, *job.RunID).First(&current).Error != nil || current.CancelRequested {
					cancel()
					return
				}
				if j.db.WithContext(ctx).Model(&current).Where("run_id = ?", *job.RunID).Update("lease_until", time.Now().Add(time.Minute)).Error != nil {
					cancel()
					return
				}
			}
		}
	}()
	var track *model.Track
	var dedup bool
	if job.Kind == "bilibili" {
		var r BiliIngestRequest
		err = json.Unmarshal([]byte(job.Payload), &r)
		if err == nil {
			track, dedup, err = j.bili.ingest(ctx, r)
		}
	} else {
		var p uploadPayload
		err = json.Unmarshal([]byte(job.Payload), &p)
		if err == nil {
			var f *os.File
			f, err = os.CreateTemp("", "ommb-job-*"+p.Ext)
			if err == nil {
				name := f.Name()
				defer os.Remove(name)
				var src io.ReadCloser
				src, err = j.store.Get(ctx, job.InputKey)
				if err == nil {
					var n int64
					n, err = io.Copy(f, io.LimitReader(src, j.maxBytes+1))
					src.Close()
					if n > j.maxBytes {
						err = fmt.Errorf("文件超出限制")
					}
				}
				f.Close()
				if err == nil {
					target, e := optionalTrackID(p.TrackID)
					err = e
					if err == nil {
						track, dedup, err = ingestAudioFile(ctx, j.db, j.store, name, p.Ext, ingestOptions{Title: p.Title, Artist: p.Artist, Source: firstNonEmpty(p.Filename, "upload"), TrackID: target})
					}
				}
			}
		}
	}
	close(done)
	<-heartbeatDone
	finishCtx, finishCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer finishCancel()
	updates := map[string]any{"status": "ready", "stage": "已完成", "progress": 100, "deduplicated": dedup}
	if err != nil {
		updates = map[string]any{"status": "failed", "stage": "处理失败", "error_message": err.Error()}
		if errors.Is(err, context.Canceled) || ctx.Err() == context.Canceled {
			updates["status"] = "cancelled"
			updates["stage"] = "已取消"
			if parent.Err() != nil {
				updates["status"] = "queued"
				updates["stage"] = "等待恢复"
			}
		}
	} else if track != nil {
		updates["track_id"] = track.ID
	}
	if e := j.db.WithContext(finishCtx).Model(&model.IngestJob{}).Where("id = ? AND run_id = ? AND status = 'processing'", job.ID, *job.RunID).Updates(updates).Error; e != nil {
		log.Printf("job completion %s: %v", job.ID, e)
	}
}

// 入库事务与任务完成共用提交，进程崩溃后不会把同一任务重复入库。
func completeJob(ctx context.Context, tx *gorm.DB, trackID int64, dedup bool) error {
	run, ok := ctx.Value(jobContextKey{}).(jobRun)
	if !ok {
		return nil
	}
	r := tx.Model(&model.IngestJob{}).Where("id = ? AND run_id = ? AND status='processing' AND NOT cancel_requested", run.ID, run.RunID).Updates(map[string]any{"status": "ready", "stage": "已完成", "progress": 100, "track_id": trackID, "deduplicated": dedup})
	if r.Error != nil {
		return r.Error
	}
	if r.RowsAffected == 0 {
		return fmt.Errorf("任务已取消或被其他工作进程接管")
	}
	return nil
}

func reportJob(ctx context.Context, db *gorm.DB, stage string, progress int) {
	if run, ok := ctx.Value(jobContextKey{}).(jobRun); ok {
		db.WithContext(ctx).Model(&model.IngestJob{}).Where("id = ? AND run_id = ? AND status='processing'", run.ID, run.RunID).Updates(map[string]any{"stage": stage, "progress": progress})
	}
}
