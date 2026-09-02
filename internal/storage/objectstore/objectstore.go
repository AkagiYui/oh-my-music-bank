// Package objectstore 封装公共资源桶与私有媒体桶。
package objectstore

import (
	"context"
	"io"
	"net/url"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"

	"github.com/akagiyui/oh-my-music-bank/internal/config"
)

// Store 对象存储客户端。
type Store struct {
	client      *minio.Client
	public      string
	private     string
	presignTTL  time.Duration
	publicURLFn func(string) string
}

// BucketKind 是持久化到清理队列的逻辑桶标识，不暴露部署使用的真实桶名。
type BucketKind string

const (
	BucketPublic  BucketKind = "public"
	BucketPrivate BucketKind = "private"
)

// New 根据配置创建对象存储客户端。endpoint 可带或不带 http(s):// 前缀。
func New(cfg config.Storage) (*Store, error) {
	endpoint := cfg.Endpoint
	secure := true
	if u, err := url.Parse(cfg.Endpoint); err == nil && u.Host != "" {
		endpoint = u.Host
		secure = u.Scheme != "http"
	} else {
		secure = !strings.HasPrefix(cfg.Endpoint, "http://")
		endpoint = strings.TrimPrefix(strings.TrimPrefix(cfg.Endpoint, "https://"), "http://")
	}

	client, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, ""),
		Secure: secure,
		Region: cfg.Region,
	})
	if err != nil {
		return nil, err
	}
	ttl, err := cfg.PresignedURLDuration()
	if err != nil {
		return nil, err
	}
	return &Store{
		client: client, public: cfg.PublicBucket, private: cfg.PrivateBucket, presignTTL: ttl,
		publicURLFn: cfg.PublicURL,
	}, nil
}

func (s *Store) bucket(kind BucketKind) string {
	if kind == BucketPublic {
		return s.public
	}
	return s.private
}

// Put 上传对象。
func (s *Store) Put(ctx context.Context, bucket BucketKind, key string, r io.Reader, size int64, contentType string) error {
	_, err := s.client.PutObject(ctx, s.bucket(bucket), key, r, size, minio.PutObjectOptions{ContentType: contentType})
	return err
}

// Get 下载对象，调用方负责关闭。
func (s *Store) Get(ctx context.Context, bucket BucketKind, key string) (io.ReadCloser, error) {
	return s.client.GetObject(ctx, s.bucket(bucket), key, minio.GetObjectOptions{})
}

// Remove 删除对象。
func (s *Store) Remove(ctx context.Context, bucket BucketKind, key string) error {
	return s.client.RemoveObject(ctx, s.bucket(bucket), key, minio.RemoveObjectOptions{})
}

// PublicURL 返回公共桶对象的对外访问地址。
func (s *Store) PublicURL(key string) string {
	return s.publicURLFn(key)
}

// PresignedPrivateGet 为私有媒体生成限时直连，并返回明确的过期时间。
func (s *Store) PresignedPrivateGet(ctx context.Context, key string) (string, time.Time, error) {
	return s.presignedPrivateGet(ctx, key, nil)
}

// PresignedPrivateDownload 为私有媒体生成带下载响应头的限时直连。
func (s *Store) PresignedPrivateDownload(ctx context.Context, key, filename string) (string, time.Time, error) {
	params := make(url.Values)
	params.Set("response-content-disposition", `attachment; filename="`+filename+`"`)
	return s.presignedPrivateGet(ctx, key, params)
}

func (s *Store) presignedPrivateGet(ctx context.Context, key string, params url.Values) (string, time.Time, error) {
	now := time.Now()
	u, err := s.client.PresignedGetObject(ctx, s.private, key, s.presignTTL, params)
	if err != nil {
		return "", time.Time{}, err
	}
	return u.String(), now.Add(s.presignTTL), nil
}
