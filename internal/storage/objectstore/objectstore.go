// Package objectstore 封装 S3 兼容对象存储（上传/下载/删除/预签名）。
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
	client *minio.Client
	bucket string
	cfg    config.Storage
}

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
	return &Store{client: client, bucket: cfg.Bucket, cfg: cfg}, nil
}

// Put 上传对象。
func (s *Store) Put(ctx context.Context, key string, r io.Reader, size int64, contentType string) error {
	_, err := s.client.PutObject(ctx, s.bucket, key, r, size, minio.PutObjectOptions{ContentType: contentType})
	return err
}

// Get 下载对象，调用方负责关闭。
func (s *Store) Get(ctx context.Context, key string) (io.ReadCloser, error) {
	return s.client.GetObject(ctx, s.bucket, key, minio.GetObjectOptions{})
}

// Remove 删除对象。
func (s *Store) Remove(ctx context.Context, key string) error {
	return s.client.RemoveObject(ctx, s.bucket, key, minio.RemoveObjectOptions{})
}

// PublicURL 返回对象的对外访问地址（基于配置的 FilePrefix，适用于公有读桶）。
func (s *Store) PublicURL(key string) string {
	return s.cfg.PublicURL(key)
}

// PresignedGet 生成限时下载链接（适用于私有桶）。
func (s *Store) PresignedGet(ctx context.Context, key string, expiry time.Duration) (string, error) {
	u, err := s.client.PresignedGetObject(ctx, s.bucket, key, expiry, nil)
	if err != nil {
		return "", err
	}
	return u.String(), nil
}

func (s *Store) Open(ctx context.Context, key string) (*minio.Object, error) {
	return s.client.GetObject(ctx, s.bucket, key, minio.GetObjectOptions{})
}
