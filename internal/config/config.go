// Package config 负责加载和解析应用配置。
//
// 配置来源优先级：环境变量 > config.yaml > 内置默认值。
// 为兼容仓库既有 .env，显式绑定了 DB / S3_* / FILE_PREFIX 等裸环境变量名，
// 同时也接受 OMMB_ 前缀的结构化覆盖（如 OMMB_SERVER_PORT）。
package config

import (
	"fmt"
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

// Storage S3 兼容对象存储配置。
type Storage struct {
	Endpoint   string `mapstructure:"endpoint"`    // 如 https://cn-nb1.rains3.com
	AccessKey  string `mapstructure:"access_key"`  //
	SecretKey  string `mapstructure:"secret_key"`  //
	Bucket     string `mapstructure:"bucket"`      //
	Region     string `mapstructure:"region"`      // 多数 S3 兼容服务可留空
	FilePrefix string `mapstructure:"file_prefix"` // 对外访问前缀，如 https://bucket.cn-nb1.rains3.com
}

// Upload 上传相关限制。
type Upload struct {
	MaxSizeMB int `mapstructure:"max_size_mb"`
}

// Config 应用总配置。
type Config struct {
	Server   Server   `mapstructure:"server"`
	Database Database `mapstructure:"database"`
	Auth     Auth     `mapstructure:"auth"`
	Storage  Storage  `mapstructure:"storage"`
	Upload   Upload   `mapstructure:"upload"`
}

// AccessTokenDuration 解析访问令牌有效期。
func (a Auth) AccessTokenDuration() (time.Duration, error) {
	return parseDuration("auth.access_token_ttl", a.AccessTokenTTL)
}

// RefreshTokenDuration 解析刷新令牌有效期。
func (a Auth) RefreshTokenDuration() (time.Duration, error) {
	return parseDuration("auth.refresh_token_ttl", a.RefreshTokenTTL)
}

// PublicURL 拼出对象 key 的对外访问地址。
func (s Storage) PublicURL(key string) string {
	if key == "" {
		return ""
	}
	prefix := strings.TrimRight(s.FilePrefix, "/")
	return prefix + "/" + strings.TrimLeft(key, "/")
}

// envBindings 将结构化配置键映射到可接受的环境变量名（首个命中者生效）。
var envBindings = map[string][]string{
	"server.host":                      {"OMMB_SERVER_HOST", "SERVER_HOST"},
	"server.port":                      {"OMMB_SERVER_PORT", "SERVER_PORT"},
	"server.socket":                    {"OMMB_SERVER_SOCKET", "SERVER_SOCKET"},
	"server.debug":                     {"OMMB_SERVER_DEBUG", "SERVER_DEBUG"},
	"database.dsn":                     {"OMMB_DATABASE_DSN", "DB", "DATABASE_DSN"},
	"database.max_open_conns":          {"OMMB_DATABASE_MAX_OPEN_CONNS"},
	"database.max_idle_conns":          {"OMMB_DATABASE_MAX_IDLE_CONNS"},
	"database.conn_max_lifetime_secs":  {"OMMB_DATABASE_CONN_MAX_LIFETIME_SECS"},
	"database.conn_max_idle_time_secs": {"OMMB_DATABASE_CONN_MAX_IDLE_TIME_SECS"},
	"database.retry_max_attempts":      {"OMMB_DATABASE_RETRY_MAX_ATTEMPTS"},
	"auth.jwt_secret":                  {"OMMB_AUTH_JWT_SECRET", "JWT_SECRET"},
	"auth.access_token_ttl":            {"OMMB_AUTH_ACCESS_TOKEN_TTL"},
	"auth.refresh_token_ttl":           {"OMMB_AUTH_REFRESH_TOKEN_TTL"},
	"storage.endpoint":                 {"OMMB_STORAGE_ENDPOINT", "S3_ENDPOINT"},
	"storage.access_key":               {"OMMB_STORAGE_ACCESS_KEY", "S3_ACCESS_KEY"},
	"storage.secret_key":               {"OMMB_STORAGE_SECRET_KEY", "S3_SECRET_KEY"},
	"storage.bucket":                   {"OMMB_STORAGE_BUCKET", "S3_BUCKET"},
	"storage.region":                   {"OMMB_STORAGE_REGION", "S3_REGION"},
	"storage.file_prefix":              {"OMMB_STORAGE_FILE_PREFIX", "FILE_PREFIX"},
	"upload.max_size_mb":               {"OMMB_UPLOAD_MAX_SIZE_MB"},
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
	if _, err := cfg.Auth.AccessTokenDuration(); err != nil {
		return nil, err
	}
	if _, err := cfg.Auth.RefreshTokenDuration(); err != nil {
		return nil, err
	}
	return cfg, nil
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
