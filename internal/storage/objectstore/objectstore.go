// Package objectstore 封装公共资源桶与私有媒体桶。
//
// 两个桶各自持有独立的 S3 客户端、endpoint 与凭据，互不共享；
// 公共桶只暴露拼接对外 URL 的能力，私有桶只暴露签发限时 URL 的能力，
// 避免调用方误把私有对象当作可公开访问，或把公开对象走预签名。
package objectstore

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"

	"github.com/akagiyui/oh-my-music-bank/internal/config"
)

// BucketKind 是持久化到清理队列的逻辑桶标识，不暴露部署使用的真实桶名。
type BucketKind string

const (
	BucketPublic  BucketKind = "public"
	BucketPrivate BucketKind = "private"
)

// bucket 单个桶的底层客户端，公共桶与私有桶各持一份。
type bucket struct {
	client *minio.Client
	name   string
	host   string
	region string
}

func newBucket(cfg config.S3) (*bucket, error) {
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
	return &bucket{client: client, name: cfg.Bucket, host: endpoint, region: cfg.Region}, nil
}

func (b *bucket) put(ctx context.Context, key string, r io.Reader, size int64, contentType string) error {
	_, err := b.client.PutObject(ctx, b.name, key, r, size, minio.PutObjectOptions{ContentType: contentType})
	return err
}

func (b *bucket) get(ctx context.Context, key string) (io.ReadCloser, error) {
	return b.client.GetObject(ctx, b.name, key, minio.GetObjectOptions{})
}

func (b *bucket) remove(ctx context.Context, key string) error {
	return b.client.RemoveObject(ctx, b.name, key, minio.RemoveObjectOptions{})
}

// check 确认桶可达且存在；用于启动自检与后台状态页。
func (b *bucket) check(ctx context.Context) error {
	ok, err := b.client.BucketExists(ctx, b.name)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("bucket %q not found", b.name)
	}
	return nil
}

// Info 是不含凭据的桶描述，供日志与管理端展示。
type Info struct {
	Kind     BucketKind `json:"kind"`
	Endpoint string     `json:"endpoint"`
	Bucket   string     `json:"bucket"`
	Region   string     `json:"region"`
}

func (b *bucket) info(kind BucketKind) Info {
	return Info{Kind: kind, Endpoint: b.host, Bucket: b.name, Region: b.region}
}

// Public 公共资源桶：封面与头像，对象可被匿名读取。
type Public struct {
	b       *bucket
	baseURL string
	urlFn   func(string) string
}

// NewPublic 根据独立配置创建公共桶客户端。
func NewPublic(cfg config.PublicStorage) (*Public, error) {
	b, err := newBucket(cfg.S3)
	if err != nil {
		return nil, err
	}
	return &Public{b: b, baseURL: strings.TrimRight(cfg.BaseURL, "/"), urlFn: cfg.PublicURL}, nil
}

// Put 上传公开对象。
func (p *Public) Put(ctx context.Context, key string, r io.Reader, size int64, contentType string) error {
	return p.b.put(ctx, key, r, size, contentType)
}

// Remove 删除公开对象。
func (p *Public) Remove(ctx context.Context, key string) error { return p.b.remove(ctx, key) }

// URL 返回公开对象的对外访问地址（公共桶或 CDN 前缀 + key）。
func (p *Public) URL(key string) string { return p.urlFn(key) }

// BaseURL 返回公开访问前缀，供状态展示。
func (p *Public) BaseURL() string { return p.baseURL }

// Check 确认公共桶可达。
func (p *Public) Check(ctx context.Context) error { return p.b.check(ctx) }

// Info 返回不含凭据的桶描述。
func (p *Public) Info() Info { return p.b.info(BucketPublic) }

// Private 私有媒体桶：音频、原始文件与暂存文件，只能通过预签名 URL 访问。
type Private struct {
	b          *bucket
	presignTTL time.Duration
}

// NewPrivate 根据独立配置创建私有桶客户端。
func NewPrivate(cfg config.PrivateStorage) (*Private, error) {
	b, err := newBucket(cfg.S3)
	if err != nil {
		return nil, err
	}
	ttl, err := cfg.PresignedURLDuration()
	if err != nil {
		return nil, err
	}
	return &Private{b: b, presignTTL: ttl}, nil
}

// Put 上传私有对象。
func (p *Private) Put(ctx context.Context, key string, r io.Reader, size int64, contentType string) error {
	return p.b.put(ctx, key, r, size, contentType)
}

// Get 下载私有对象，调用方负责关闭。
func (p *Private) Get(ctx context.Context, key string) (io.ReadCloser, error) {
	return p.b.get(ctx, key)
}

// Remove 删除私有对象。
func (p *Private) Remove(ctx context.Context, key string) error { return p.b.remove(ctx, key) }

// Check 确认私有桶可达。
func (p *Private) Check(ctx context.Context) error { return p.b.check(ctx) }

// Info 返回不含凭据的桶描述。
func (p *Private) Info() Info { return p.b.info(BucketPrivate) }

// PresignTTL 返回预签名 URL 有效期。
func (p *Private) PresignTTL() time.Duration { return p.presignTTL }

// PresignedGet 为私有媒体生成限时直连，并返回明确的过期时间。
func (p *Private) PresignedGet(ctx context.Context, key string) (string, time.Time, error) {
	return p.presigned(ctx, key, nil)
}

// PresignedDownload 为私有媒体生成带下载响应头的限时直连。
func (p *Private) PresignedDownload(ctx context.Context, key, filename string) (string, time.Time, error) {
	params := make(url.Values)
	params.Set("response-content-disposition", `attachment; filename="`+filename+`"`)
	return p.presigned(ctx, key, params)
}

func (p *Private) presigned(ctx context.Context, key string, params url.Values) (string, time.Time, error) {
	now := time.Now()
	u, err := p.b.client.PresignedGetObject(ctx, p.b.name, key, p.presignTTL, params)
	if err != nil {
		return "", time.Time{}, err
	}
	return u.String(), now.Add(p.presignTTL), nil
}

// Stores 聚合两套独立的桶客户端，供同时需要读写两类对象的流程（入库、清理）使用。
type Stores struct {
	Public  *Public
	Private *Private
}

// New 分别用各自的配置创建公共桶与私有桶客户端。
func New(cfg config.Storage) (Stores, error) {
	pub, err := NewPublic(cfg.Public)
	if err != nil {
		return Stores{}, fmt.Errorf("public bucket: %w", err)
	}
	priv, err := NewPrivate(cfg.Private)
	if err != nil {
		return Stores{}, fmt.Errorf("private bucket: %w", err)
	}
	return Stores{Public: pub, Private: priv}, nil
}

// Remove 按逻辑桶标识删除对象，供清理队列分发。
func (s Stores) Remove(ctx context.Context, kind BucketKind, key string) error {
	switch kind {
	case BucketPublic:
		return s.Public.Remove(ctx, key)
	case BucketPrivate:
		return s.Private.Remove(ctx, key)
	default:
		return fmt.Errorf("unknown bucket kind %q", kind)
	}
}

// Check 依次自检两个桶，任一失败即返回带桶标识的错误。
func (s Stores) Check(ctx context.Context) error {
	var errs []error
	if err := s.Public.Check(ctx); err != nil {
		errs = append(errs, fmt.Errorf("public bucket %s/%s: %w", s.Public.b.host, s.Public.b.name, err))
	}
	if err := s.Private.Check(ctx); err != nil {
		errs = append(errs, fmt.Errorf("private bucket %s/%s: %w", s.Private.b.host, s.Private.b.name, err))
	}
	return errors.Join(errs...)
}
