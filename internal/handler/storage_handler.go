package handler

import (
	"context"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/akagiyui/oh-my-music-bank/internal/storage/objectstore"
	"github.com/akagiyui/oh-my-music-bank/pkg/response"
)

// StorageHandler 向管理端暴露两套对象存储的脱敏配置与连通性，便于确认桶没有被混用。
type StorageHandler struct {
	store objectstore.Stores
}

// NewStorageHandler 创建对象存储状态处理器。
func NewStorageHandler(store objectstore.Stores) *StorageHandler {
	return &StorageHandler{store: store}
}

// BucketStatusDTO 单个桶的状态，不包含任何凭据。
type BucketStatusDTO struct {
	objectstore.Info
	// 公共桶的对外访问前缀；私有桶为空。
	BaseURL string `json:"baseUrl,omitempty"`
	// 私有桶预签名 URL 有效期（秒）；公共桶为 0。
	PresignTTLSeconds int64  `json:"presignTtlSeconds,omitempty"`
	Reachable         bool   `json:"reachable"`
	Error             string `json:"error,omitempty"`
}

// Status 对两个桶各做一次带超时的连通性检查并返回结果。
func (h *StorageHandler) Status(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 8*time.Second)
	defer cancel()

	pub := BucketStatusDTO{Info: h.store.Public.Info(), BaseURL: h.store.Public.BaseURL(), Reachable: true}
	if err := h.store.Public.Check(ctx); err != nil {
		pub.Reachable, pub.Error = false, err.Error()
	}
	priv := BucketStatusDTO{Info: h.store.Private.Info(), PresignTTLSeconds: int64(h.store.Private.PresignTTL().Seconds()), Reachable: true}
	if err := h.store.Private.Check(ctx); err != nil {
		priv.Reachable, priv.Error = false, err.Error()
	}
	c.Header("Cache-Control", "private, no-store")
	response.Success(c, gin.H{"public": pub, "private": priv, "checkedAt": time.Now().UTC()})
}
