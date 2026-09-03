// Oh My Music Bank 服务端启动入口。
package main

import (
	"context"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/akagiyui/oh-my-music-bank/internal/config"
	"github.com/akagiyui/oh-my-music-bank/internal/handler"
	"github.com/akagiyui/oh-my-music-bank/internal/router"
	"github.com/akagiyui/oh-my-music-bank/internal/service/bilibili"
	"github.com/akagiyui/oh-my-music-bank/internal/service/cache"
	"github.com/akagiyui/oh-my-music-bank/internal/storage/db"
	"github.com/akagiyui/oh-my-music-bank/internal/storage/objectstore"
)

func main() {
	cfg, err := config.Load("config.yaml")
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}

	if !cfg.Server.Debug {
		gin.SetMode(gin.ReleaseMode)
	}

	dbConn, err := initDBWithRetry(cfg.Database)
	if err != nil {
		log.Fatalf("连接数据库失败: %v", err)
	}

	cacheMgr := cache.New(dbConn)
	if err := cacheMgr.WarmSettings(); err != nil {
		log.Fatalf("加载站点设置失败: %v", err)
	}
	cacheMgr.StartBackgroundRefresh(60 * time.Second)

	store, err := objectstore.New(cfg.Storage)
	if err != nil {
		log.Fatalf("初始化对象存储失败: %v", err)
	}
	// 启动时分别确认公共桶与私有桶可达，配置错误立即失败而不是等到首次上传。
	checkCtx, cancelCheck := context.WithTimeout(context.Background(), 20*time.Second)
	if err := store.Check(checkCtx); err != nil {
		log.Fatalf("对象存储自检失败: %v", err)
	}
	cancelCheck()
	log.Printf("对象存储就绪: 公共桶 %s/%s，私有桶 %s/%s", store.Public.Info().Endpoint, store.Public.Info().Bucket, store.Private.Info().Endpoint, store.Private.Info().Bucket)

	biliClient := bilibili.New()
	jobs := handler.NewJobs(dbConn, store, handler.NewBilibiliHandler(dbConn, store, cacheMgr, biliClient), int64(cfg.Upload.MaxSizeMB)<<20)
	jobs.Start()
	engine := router.Setup(router.SetupDeps{
		DB:     dbConn,
		Config: cfg,
		Cache:  cacheMgr,
		Store:  store,
		Bili:   biliClient,
		Jobs:   jobs,
	})

	engine.GET("/health", func(c *gin.Context) {
		sqlDB, err := dbConn.DB()
		if err != nil || sqlDB.Ping() != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"status": "unhealthy"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "healthy"})
	})

	listener, listenAddr, err := buildListener(cfg.Server)
	if err != nil {
		log.Fatalf("监听失败: %v", err)
	}

	srv := &http.Server{Handler: engine, ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 10 * time.Minute, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 1 << 20}
	go func() {
		log.Printf("服务已启动: %s", listenAddr)
		if err := srv.Serve(listener); err != nil && err != http.ErrServerClosed {
			log.Fatalf("服务启动失败: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("正在关闭服务...")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	cacheMgr.Stop()
	jobs.Stop()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("强制关闭: %v", err)
	}
	if cfg.Server.Socket != "" {
		os.Remove(cfg.Server.Socket)
	}
	if sqlDB, _ := dbConn.DB(); sqlDB != nil {
		sqlDB.Close()
	}
	log.Println("服务已退出")
}

// buildListener 优先使用 Unix socket，否则回退到 TCP。
func buildListener(cfg config.Server) (net.Listener, string, error) {
	if cfg.Socket != "" {
		if err := os.MkdirAll(filepath.Dir(cfg.Socket), 0o755); err != nil {
			return nil, "", err
		}
		os.Remove(cfg.Socket)
		ln, err := net.Listen("unix", cfg.Socket)
		if err != nil {
			return nil, "", err
		}
		if err := os.Chmod(cfg.Socket, 0o666); err != nil {
			log.Printf("警告：设置 socket 权限失败: %v", err)
		}
		return ln, cfg.Socket, nil
	}
	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	ln, err := net.Listen("tcp", addr)
	return ln, addr, err
}

// initDBWithRetry 初始化数据库连接并执行迁移，支持指数退避重试。
func initDBWithRetry(cfg config.Database) (*gorm.DB, error) {
	maxRetries := cfg.RetryMaxAttempts
	if maxRetries <= 0 {
		maxRetries = 1
	}
	var lastErr error
	for i := 0; i < maxRetries; i++ {
		dbConn, err := db.Init(cfg.DSN, cfg.MaxOpenConns, cfg.MaxIdleConns, cfg.ConnMaxLifetimeSecs, cfg.ConnMaxIdleTimeSecs)
		if err == nil {
			if err = db.Migrate(dbConn); err == nil {
				return dbConn, nil
			}
		}
		lastErr = err
		log.Printf("数据库初始化第 %d/%d 次失败: %v", i+1, maxRetries, err)
		if i < maxRetries-1 {
			backoff := time.Duration(1<<i) * time.Second
			log.Printf("%v 后重试...", backoff)
			time.Sleep(backoff)
		}
	}
	return nil, lastErr
}
