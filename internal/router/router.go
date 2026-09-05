// Package router 组装 HTTP 路由、中间件与处理器。
package router

import (
	"strings"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/akagiyui/oh-my-music-bank/internal/config"
	"github.com/akagiyui/oh-my-music-bank/internal/handler"
	"github.com/akagiyui/oh-my-music-bank/internal/middleware"
	"github.com/akagiyui/oh-my-music-bank/internal/service/bilibili"
	"github.com/akagiyui/oh-my-music-bank/internal/service/cache"
	"github.com/akagiyui/oh-my-music-bank/internal/storage/objectstore"
)

// SetupDeps 路由初始化所需依赖。
type SetupDeps struct {
	DB     *gorm.DB
	Config *config.Config
	Cache  *cache.Manager
	Store  objectstore.Stores
	Bili   *bilibili.Client
	Jobs   *handler.Jobs
}

// Setup 初始化处理器、中间件并返回 gin 引擎。
func Setup(deps SetupDeps) *gin.Engine {
	authHandler := handler.NewAuthHandler(deps.DB, deps.Config.Auth, deps.Cache)
	apikeyHandler := handler.NewAPIKeyHandler(deps.DB)
	userHandler := handler.NewUserHandler(deps.DB)
	siteHandler := handler.NewSiteHandler(deps.DB, deps.Cache)
	trackHandler := handler.NewTrackHandler(deps.DB, deps.Store.Public)
	artistHandler := handler.NewArtistHandler(deps.DB, deps.Store.Public)
	albumHandler := handler.NewAlbumHandler(deps.DB, deps.Store.Public)
	languageHandler := handler.NewLanguageHandler(deps.DB)
	audioHandler := handler.NewAudioHandler(deps.DB, deps.Store, deps.Config.Upload)
	publicHandler := handler.NewPublicHandler(deps.DB, deps.Store.Public)
	statsHandler := handler.NewStatsHandler(deps.DB)
	logHandler := handler.NewLogHandler(deps.DB)
	integrationsHandler := handler.NewIntegrationsHandler(deps.Cache, deps.Store.Private, deps.Config.Recognize.NeteaseAFPDir)
	metadataHandler := handler.NewMetadataHandler(deps.DB, deps.Store.Public)
	storageHandler := handler.NewStorageHandler(deps.Store)
	bilibiliHandler := handler.NewBilibiliHandler(deps.DB, deps.Store, deps.Cache, deps.Bili)

	engine := gin.New()
	engine.Use(gin.Recovery())
	_ = engine.SetTrustedProxies(nil)
	engine.Use(func(c *gin.Context) {
		c.Set("media_auth", deps.Config.Auth)
		c.Header("Referrer-Policy", "no-referrer")
		c.Next()
	})
	engine.Use(func(c *gin.Context) {
		limit := int64(1 << 20)
		if strings.HasPrefix(c.GetHeader("Content-Type"), "multipart/form-data") {
			limit = (int64(deps.Config.Upload.MaxSizeMB) << 20) + (1 << 20)
		}
		middleware.BodyLimit(limit)(c)
	})
	if deps.Config.Server.Debug {
		engine.Use(gin.Logger())
	}
	engine.MaxMultipartMemory = 32 << 20

	engine.Use(cors.New(cors.Config{
		AllowOrigins: []string{"*"},
		AllowMethods: []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders: []string{"Origin", "Content-Type", "Accept", "Authorization", "X-API-Key", "Range"},
		// 前后端分离部署时，波形解码器需要读取 Range 响应的边界与完整文件大小。
		ExposeHeaders:    []string{"Content-Length", "Content-Range", "Accept-Ranges"},
		AllowCredentials: false,
		MaxAge:           12 * time.Hour,
	}))

	// 仅搜索与曲目详情记录调用日志；日志中间件先于限流和鉴权，保留失败请求。
	open := engine.Group("/api/open/v1")
	open.Use(middleware.APILogMiddleware(deps.DB))
	open.Use(middleware.IPRateLimit(deps.DB, "open-ip:", 300))
	open.Use(middleware.APIKeyAuthMiddleware(deps.DB))
	{
		open.GET("/search", publicHandler.Search)
		open.GET("/tracks/:id", publicHandler.GetTrack)
	}

	// 播放地址按需签发且不落 API 调用日志，避免高频播放刷新污染检索统计。
	mediaOpen := engine.Group("/api/open/v1")
	mediaOpen.Use(middleware.IPRateLimit(deps.DB, "open-media-ip:", 300))
	mediaOpen.Use(middleware.APIKeyAuthMiddleware(deps.DB))
	mediaOpen.POST("/audios/:id/playback-url", audioHandler.PublicPlaybackURL)

	// 公共接口（无需鉴权）。
	pub := engine.Group("/api/v1")
	{
		pub.GET("/site", siteHandler.PublicConfig)
		auth := pub.Group("/auth")
		auth.Use(middleware.BodyLimit(1<<20), middleware.IPRateLimit(deps.DB, "auth:", 20))
		auth.POST("/register", authHandler.Register)
		auth.POST("/login", authHandler.Login)
		auth.POST("/refresh", authHandler.Refresh)
	}

	// 需登录接口。
	authd := engine.Group("/api/v1")
	authd.Use(middleware.WebAuthMiddleware(deps.Config.Auth, deps.DB))
	{
		authd.GET("/auth/me", authHandler.Me)
		authd.POST("/auth/logout", authHandler.Logout)

		ak := authd.Group("/api-keys")
		{
			ak.GET("", apikeyHandler.List)
			ak.POST("", apikeyHandler.Create)
			ak.PUT("/:id", apikeyHandler.Update)
			ak.POST("/:id/revoke", apikeyHandler.Revoke)
			ak.DELETE("/:id", apikeyHandler.Delete)
		}

		profile := authd.Group("/profile")
		{
			profile.PUT("/email", userHandler.UpdateProfileEmail)
			profile.PUT("/password", userHandler.ChangeProfilePassword)
		}

		// 管理端（需 admin）。
		admin := authd.Group("/admin")
		admin.Use(middleware.AdminOnly())
		{
			stats := admin.Group("/stats")
			{
				stats.GET("/overview", statsHandler.Overview)
				stats.GET("/timeseries", statsHandler.Timeseries)
			}

			admin.GET("/logs", logHandler.List)
			admin.GET("/storage", storageHandler.Status)
			if deps.Jobs != nil {
				admin.GET("/jobs", deps.Jobs.List)
				admin.POST("/jobs/upload", deps.Jobs.Upload)
				admin.POST("/jobs/bilibili", deps.Jobs.Bilibili)
				admin.POST("/jobs/:id/cancel", deps.Jobs.Cancel)
				admin.POST("/jobs/:id/retry", deps.Jobs.Retry)
			}

			users := admin.Group("/users")
			{
				users.GET("", userHandler.List)
				users.PUT("/:id/role", userHandler.UpdateRole)
				users.PUT("/:id/active", userHandler.ToggleActive)
				users.DELETE("/:id", userHandler.Delete)
			}

			adminKeys := admin.Group("/api-keys")
			{
				adminKeys.GET("", apikeyHandler.AdminList)
				adminKeys.PUT("/:id", apikeyHandler.AdminUpdate)
				adminKeys.DELETE("/:id", apikeyHandler.AdminDelete)
			}

			tracks := admin.Group("/tracks")
			{
				tracks.GET("", trackHandler.List)
				tracks.POST("/:id/merge", trackHandler.Merge)
				tracks.GET("/:id", trackHandler.Detail)
				tracks.PUT("/:id", trackHandler.Update)
				tracks.DELETE("/:id", trackHandler.Delete)
				tracks.POST("/:id/aliases", trackHandler.AddAlias)
				tracks.DELETE("/:id/aliases/:aliasId", trackHandler.DeleteAlias)
				tracks.PUT("/:id/artists", trackHandler.SetArtists)
				tracks.PUT("/:id/albums", trackHandler.SetAlbums)
				tracks.PUT("/:id/languages", trackHandler.SetLanguages)
				tracks.POST("/:id/enrich", metadataHandler.Enrich)
			}

			artists := admin.Group("/artists")
			{
				artists.GET("", artistHandler.List)
				artists.POST("/:id/merge", artistHandler.Merge)
				artists.POST("", artistHandler.Create)
				artists.GET("/:id", artistHandler.Detail)
				artists.PUT("/:id", artistHandler.Update)
				artists.DELETE("/:id", artistHandler.Delete)
				artists.POST("/:id/aliases", artistHandler.AddAlias)
				artists.DELETE("/:id/aliases/:aliasId", artistHandler.DeleteAlias)
			}

			albums := admin.Group("/albums")
			{
				albums.GET("", albumHandler.List)
				albums.PUT("/:id/tracks/order", albumHandler.OrderTracks)
				albums.POST("", albumHandler.Create)
				albums.GET("/:id", albumHandler.Detail)
				albums.PUT("/:id", albumHandler.Update)
				albums.DELETE("/:id", albumHandler.Delete)
				albums.PUT("/:id/artists", albumHandler.SetArtists)
			}

			languages := admin.Group("/languages")
			{
				languages.GET("", languageHandler.List)
				languages.POST("", languageHandler.Create)
				languages.DELETE("/:id", languageHandler.Delete)
			}

			audio := admin.Group("/audios")
			{
				audio.POST("/upload", audioHandler.Upload)
				audio.DELETE("/:id", audioHandler.DeleteAudio)
				audio.POST("/:id/playback-url", audioHandler.AdminPlaybackURL)
			}
			admin.POST("/origin-audios/:id/download-url", audioHandler.OriginDownloadURL)

			site := admin.Group("/site")
			{
				site.GET("/settings", siteHandler.AdminGetSettings)
				site.PUT("/settings", siteHandler.AdminUpdateSettings)
			}

			integrations := admin.Group("/integrations")
			{
				integrations.GET("", integrationsHandler.Get)
				integrations.PUT("", integrationsHandler.Update)
				integrations.POST("/test", integrationsHandler.Test)
				integrations.POST("/netease-afp/fetch", integrationsHandler.FetchNeteaseAFP)
				integrations.DELETE("/netease-afp", integrationsHandler.DeleteNeteaseAFP)
				integrations.GET("/netease-afp/asset/:name", integrationsHandler.NeteaseAFPAsset)
			}

			meta := admin.Group("/metadata")
			{
				meta.GET("/search", metadataHandler.Search)
				meta.GET("/song/:id", metadataHandler.Song)
			}

			bili := admin.Group("/bilibili")
			{
				bili.POST("/media-token", bilibiliHandler.MediaToken)
				bili.GET("/accounts", bilibiliHandler.Accounts)
				bili.POST("/login", bilibiliHandler.CreateLogin)
				bili.POST("/login/:loginId/poll", bilibiliHandler.PollLogin)
				bili.PUT("/accounts/:accountId/default", bilibiliHandler.DefaultAccount)
				bili.POST("/accounts/:accountId/refresh", bilibiliHandler.RefreshAccount)
				bili.DELETE("/accounts/:accountId", bilibiliHandler.DeleteAccount)
				bili.GET("/status", bilibiliHandler.Status)
				bili.GET("/favorites", bilibiliHandler.Favorites)
				bili.GET("/favorites/:mediaId", bilibiliHandler.FavoriteItems)
				bili.GET("/resolve", bilibiliHandler.Resolve)
				bili.POST("/ingest", bilibiliHandler.Ingest)
				bili.POST("/recognize", bilibiliHandler.Recognize)
				bili.POST("/recognize/pcm", bilibiliHandler.RecognizePCM)
			}
		}
	}

	// 哔哩哔哩音频代理：媒体元素无法带 Authorization 头，改用 query token 鉴权。
	engine.GET("/api/v1/admin/bilibili/stream",
		middleware.MediaTokenAuth(deps.Config.Auth, deps.DB), bilibiliHandler.Stream)

	return engine
}
