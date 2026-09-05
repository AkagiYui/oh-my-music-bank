// Package config 负责加载和解析应用配置。
//
// 配置来源优先级：环境变量 > config.yaml > 内置默认值。
// 显式绑定 DB / S3_PUBLIC_* / S3_PRIVATE_* 等环境变量名，
// 同时也接受 OMMB_ 前缀的结构化覆盖（如 OMMB_SERVER_PORT）。
package config

import (
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
	"github.com/spf13/viper"
)

const (
	defaultServerHost          = "0.0.0.0"
	defaultServerPort          = 9111
	defaultDatabaseMaxOpen     = 20
	defaultDatabaseMaxIdle     = 10
	defaultConnMaxLifetimeSecs = 1800
	defaultConnMaxIdleTimeSecs = 300
	defaultDBRetryMaxAttempts  = 5
	defaultAccessTokenTTL      = "15m"
	defaultRefreshTokenTTL     = "168h"
	defaultUploadMaxSizeMB     = 200
	defaultNeteaseAFPDir       = "/opt/ommb/netease-afp"
)

// Server HTTP 服务配置，支持 TCP 与 Unix Socket 两种监听方式。
type Server struct {
	Host   string `mapstructure:"host"`
	Port   int    `mapstructure:"port"`
	Socket string `mapstructure:"socket"` // 设置后优先使用 socket（与 Caddy 直连）
	Debug  bool   `mapstructure:"debug"`
}

// Database 数据库连接与连接池配置。
type Database struct {
	DSN                 string `mapstructure:"dsn"`
	MaxOpenConns        int    `mapstructure:"max_open_conns"`
	MaxIdleConns        int    `mapstructure:"max_idle_conns"`
	ConnMaxLifetimeSecs int    `mapstructure:"conn_max_lifetime_secs"`
	ConnMaxIdleTimeSecs int    `mapstructure:"conn_max_idle_time_secs"`
	RetryMaxAttempts    int    `mapstructure:"retry_max_attempts"`
}

// Auth 认证配置：JWT 密钥与令牌有效期。
type Auth struct {
	JWTSecret       string `mapstructure:"jwt_secret"`
	AccessTokenTTL  string `mapstructure:"access_token_ttl"`
	RefreshTokenTTL string `mapstructure:"refresh_token_ttl"`
}

// S3 单个 S3 兼容桶的连接配置。公共桶与私有桶各自独立持有一套，互不共享。
type S3 struct {
	Endpoint  string `mapstructure:"endpoint"`   // 如 https://cn-nb1.rains3.com，可带或不带协议
	AccessKey string `mapstructure:"access_key"` // 仅对该桶授权的最小权限 Access Key
	SecretKey string `mapstructure:"secret_key"` // 仅对该桶授权的最小权限 Secret Key
	Bucket    string `mapstructure:"bucket"`     // 桶名
	Region    string `mapstructure:"region"`     // 多数 S3 兼容服务可留空
}

// PublicStorage 公开静态资源桶（封面、头像），对象允许匿名读取。
type PublicStorage struct {
	S3      `mapstructure:",squash"`
	BaseURL string `mapstructure:"base_url"` // 公开桶或 CDN 的 HTTPS 访问前缀
}

// PrivateStorage 私有媒体桶（音频、原始文件、暂存文件），只通过预签名 URL 访问。
type PrivateStorage struct {
	S3              `mapstructure:",squash"`
	PresignedURLTTL string `mapstructure:"presigned_url_ttl"` // 临时 URL 有效期
}

// Storage 对象存储配置：公共桶与私有桶是两套完全独立的 S3 连接。
type Storage struct {
	Public  PublicStorage  `mapstructure:"public"`
	Private PrivateStorage `mapstructure:"private"`
}

// Upload 上传相关限制。
type Upload struct {
	MaxSizeMB int `mapstructure:"max_size_mb"`
}

// Recognize 听歌识曲相关的本地资源位置。
type Recognize struct {
	// NeteaseAFPDir 镜像内预置的网易云指纹资源目录；管理员另行拉取的副本优先。
	NeteaseAFPDir string `mapstructure:"netease_afp_dir"`
}

// Config 应用总配置。
type Config struct {
	Server   Server   `mapstructure:"server"`
	Database Database `mapstructure:"database"`
	Auth     Auth     `mapstructure:"auth"`
	Storage  Storage  `mapstructure:"storage"`
	Upload   Upload   `mapstructure:"upload"`

	Recognize Recognize `mapstructure:"recognize"`
}

// AccessTokenDuration 解析访问令牌有效期。
func (a Auth) AccessTokenDuration() (time.Duration, error) {
	return parseDuration("auth.access_token_ttl", a.AccessTokenTTL)
}

// RefreshTokenDuration 解析刷新令牌有效期。
func (a Auth) RefreshTokenDuration() (time.Duration, error) {
	return parseDuration("auth.refresh_token_ttl", a.RefreshTokenTTL)
}

// PublicURL 拼出公共桶对象 key 的对外访问地址。
func (p PublicStorage) PublicURL(key string) string {
	if key == "" {
		return ""
	}
	prefix := strings.TrimRight(p.BaseURL, "/")
	return prefix + "/" + strings.TrimLeft(key, "/")
}

// PresignedURLDuration 解析私有对象临时 URL 的有效期。
func (p PrivateStorage) PresignedURLDuration() (time.Duration, error) {
	return parseDuration("storage.private.presigned_url_ttl", p.PresignedURLTTL)
}

// EndpointHost 返回去掉协议与路径后的 endpoint 主机，用于日志与状态展示。
func (b S3) EndpointHost() string {
	if u, err := url.Parse(b.Endpoint); err == nil && u.Host != "" {
		return u.Host
	}
	return strings.TrimPrefix(strings.TrimPrefix(b.Endpoint, "https://"), "http://")
}

// envBindings 将结构化配置键映射到可接受的环境变量名（首个命中者生效）。
var envBindings = map[string][]string{
	"server.host":                       {"OMMB_SERVER_HOST", "SERVER_HOST"},
	"server.port":                       {"OMMB_SERVER_PORT", "SERVER_PORT"},
	"server.socket":                     {"OMMB_SERVER_SOCKET", "SERVER_SOCKET"},
	"server.debug":                      {"OMMB_SERVER_DEBUG", "SERVER_DEBUG"},
	"database.dsn":                      {"OMMB_DATABASE_DSN", "DB", "DATABASE_DSN"},
	"database.max_open_conns":           {"OMMB_DATABASE_MAX_OPEN_CONNS"},
	"database.max_idle_conns":           {"OMMB_DATABASE_MAX_IDLE_CONNS"},
	"database.conn_max_lifetime_secs":   {"OMMB_DATABASE_CONN_MAX_LIFETIME_SECS"},
	"database.conn_max_idle_time_secs":  {"OMMB_DATABASE_CONN_MAX_IDLE_TIME_SECS"},
	"database.retry_max_attempts":       {"OMMB_DATABASE_RETRY_MAX_ATTEMPTS"},
	"auth.jwt_secret":                   {"OMMB_AUTH_JWT_SECRET", "JWT_SECRET"},
	"auth.access_token_ttl":             {"OMMB_AUTH_ACCESS_TOKEN_TTL"},
	"auth.refresh_token_ttl":            {"OMMB_AUTH_REFRESH_TOKEN_TTL"},
	"storage.public.endpoint":           {"OMMB_STORAGE_PUBLIC_ENDPOINT", "S3_PUBLIC_ENDPOINT"},
	"storage.public.access_key":         {"OMMB_STORAGE_PUBLIC_ACCESS_KEY", "S3_PUBLIC_ACCESS_KEY"},
	"storage.public.secret_key":         {"OMMB_STORAGE_PUBLIC_SECRET_KEY", "S3_PUBLIC_SECRET_KEY"},
	"storage.public.bucket":             {"OMMB_STORAGE_PUBLIC_BUCKET", "S3_PUBLIC_BUCKET"},
	"storage.public.region":             {"OMMB_STORAGE_PUBLIC_REGION", "S3_PUBLIC_REGION"},
	"storage.public.base_url":           {"OMMB_STORAGE_PUBLIC_BASE_URL", "S3_PUBLIC_BASE_URL"},
	"storage.private.endpoint":          {"OMMB_STORAGE_PRIVATE_ENDPOINT", "S3_PRIVATE_ENDPOINT"},
	"storage.private.access_key":        {"OMMB_STORAGE_PRIVATE_ACCESS_KEY", "S3_PRIVATE_ACCESS_KEY"},
	"storage.private.secret_key":        {"OMMB_STORAGE_PRIVATE_SECRET_KEY", "S3_PRIVATE_SECRET_KEY"},
	"storage.private.bucket":            {"OMMB_STORAGE_PRIVATE_BUCKET", "S3_PRIVATE_BUCKET"},
	"storage.private.region":            {"OMMB_STORAGE_PRIVATE_REGION", "S3_PRIVATE_REGION"},
	"storage.private.presigned_url_ttl": {"OMMB_STORAGE_PRIVATE_PRESIGNED_URL_TTL", "S3_PRIVATE_PRESIGNED_URL_TTL"},
	"recognize.netease_afp_dir":         {"OMMB_RECOGNIZE_NETEASE_AFP_DIR"},
	"upload.max_size_mb":                {"OMMB_UPLOAD_MAX_SIZE_MB"},
}

// Load 从配置文件和环境变量加载应用配置。
func Load(configPath string) (*Config, error) {
	cfg, err := load(configPath)
	if err != nil {
		return nil, err
	}
	if len(strings.TrimSpace(cfg.Auth.JWTSecret)) < 32 {
		return nil, fmt.Errorf("auth.jwt_secret must contain at least 32 bytes")
	}
	if cfg.Upload.MaxSizeMB < 1 || cfg.Upload.MaxSizeMB > 2048 {
		return nil, fmt.Errorf("upload.max_size_mb must be between 1 and 2048")
	}
	if err := validateDatabase(cfg.Database); err != nil {
		return nil, err
	}
	if err := validateStorage(cfg.Storage); err != nil {
		return nil, err
	}
	if _, err := cfg.Auth.AccessTokenDuration(); err != nil {
		return nil, err
	}
	if _, err := cfg.Auth.RefreshTokenDuration(); err != nil {
		return nil, err
	}
	return cfg, nil
}

func validateStorage(cfg Storage) error {
	if err := validateS3("storage.public", cfg.Public.S3); err != nil {
		return err
	}
	if err := validateS3("storage.private", cfg.Private.S3); err != nil {
		return err
	}
	// 两套配置必须指向不同的物理桶：同一 endpoint 下不允许复用桶名。
	if strings.EqualFold(cfg.Public.EndpointHost(), cfg.Private.EndpointHost()) && cfg.Public.Bucket == cfg.Private.Bucket {
		return fmt.Errorf("storage.public and storage.private must not point to the same bucket")
	}
	if strings.TrimSpace(cfg.Public.BaseURL) == "" {
		return fmt.Errorf("storage.public.base_url is required")
	}
	u, err := url.Parse(cfg.Public.BaseURL)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.RawQuery != "" || u.Fragment != "" {
		return fmt.Errorf("storage.public.base_url must be an absolute HTTPS URL without query or fragment")
	}
	ttl, err := cfg.Private.PresignedURLDuration()
	if err != nil {
		return err
	}
	if ttl < time.Minute || ttl > 7*24*time.Hour {
		return fmt.Errorf("storage.private.presigned_url_ttl must be between 1m and 168h")
	}
	return nil
}

// validateS3 校验单个桶的必填字段与 endpoint 格式。
func validateS3(prefix string, cfg S3) error {
	for _, f := range []struct{ name, value string }{
		{"endpoint", cfg.Endpoint}, {"access_key", cfg.AccessKey}, {"secret_key", cfg.SecretKey}, {"bucket", cfg.Bucket},
	} {
		if strings.TrimSpace(f.value) == "" {
			return fmt.Errorf("%s.%s is required", prefix, f.name)
		}
	}
	if cfg.EndpointHost() == "" {
		return fmt.Errorf("%s.endpoint must contain a host", prefix)
	}
	return nil
}

// LoadDatabase 供维护命令复用配置来源，无需提供 JWT 或对象存储配置。
func LoadDatabase(configPath string) (Database, error) {
	cfg, err := load(configPath)
	if err != nil {
		return Database{}, err
	}
	return cfg.Database, validateDatabase(cfg.Database)
}

func validateDatabase(cfg Database) error {
	if strings.TrimSpace(cfg.DSN) == "" {
		return fmt.Errorf("database dsn is required (set env DB or OMMB_DATABASE_DSN)")
	}
	return nil
}

// load 统一解析配置，具体入口仅校验自身需要的字段。
func load(configPath string) (*Config, error) {
	// 静默加载 .env（不存在则忽略）。
	_ = godotenv.Load()

	v := viper.New()
	setDefaults(v)
	v.SetConfigType("yaml")

	for key, envs := range envBindings {
		// BindEnv 第一个参数为配置键，其余为按序尝试的环境变量名。
		args := append([]string{key}, envs...)
		if err := v.BindEnv(args...); err != nil {
			return nil, fmt.Errorf("bind env %s: %w", key, err)
		}
	}

	if configPath != "" {
		v.SetConfigFile(configPath)
	} else {
		v.SetConfigName("config")
		v.AddConfigPath(".")
	}

	if err := v.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok && !os.IsNotExist(err) {
			if !strings.Contains(err.Error(), "no such file") {
				return nil, fmt.Errorf("read config: %w", err)
			}
		}
	}

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("unmarshal config: %w", err)
	}

	return &cfg, nil
}

func setDefaults(v *viper.Viper) {
	v.SetDefault("server.host", defaultServerHost)
	v.SetDefault("server.port", defaultServerPort)
	v.SetDefault("server.debug", false)
	v.SetDefault("database.max_open_conns", defaultDatabaseMaxOpen)
	v.SetDefault("database.max_idle_conns", defaultDatabaseMaxIdle)
	v.SetDefault("database.conn_max_lifetime_secs", defaultConnMaxLifetimeSecs)
	v.SetDefault("database.conn_max_idle_time_secs", defaultConnMaxIdleTimeSecs)
	v.SetDefault("database.retry_max_attempts", defaultDBRetryMaxAttempts)
	v.SetDefault("auth.access_token_ttl", defaultAccessTokenTTL)
	v.SetDefault("auth.refresh_token_ttl", defaultRefreshTokenTTL)
	v.SetDefault("upload.max_size_mb", defaultUploadMaxSizeMB)
	v.SetDefault("storage.private.presigned_url_ttl", "30m")
	v.SetDefault("recognize.netease_afp_dir", defaultNeteaseAFPDir)
}

// parseDuration 解析时间字符串，额外支持 "d"（天）单位。
func parseDuration(field, raw string) (time.Duration, error) {
	if before, after, ok := strings.Cut(raw, "d"); ok {
		d, err := strconv.ParseFloat(before, 64)
		if err != nil {
			return 0, fmt.Errorf("parse %s: invalid days %q: %w", field, before, err)
		}
		total := time.Duration(d * float64(24*time.Hour))
		if rest := after; rest != "" {
			sub, err := time.ParseDuration(rest)
			if err != nil {
				return 0, fmt.Errorf("parse %s: %w", field, err)
			}
			total += sub
		}
		if total <= 0 {
			return 0, fmt.Errorf("%s must be positive", field)
		}
		return total, nil
	}
	parsed, err := time.ParseDuration(raw)
	if err != nil {
		return 0, fmt.Errorf("parse %s: %w", field, err)
	}
	if parsed <= 0 {
		return 0, fmt.Errorf("%s must be positive", field)
	}
	return parsed, nil
}
