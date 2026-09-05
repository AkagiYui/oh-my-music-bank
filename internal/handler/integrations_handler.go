package handler

import (
	"bytes"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/akagiyui/oh-my-music-bank/internal/service/cache"
	"github.com/akagiyui/oh-my-music-bank/internal/service/recognize"
	"github.com/akagiyui/oh-my-music-bank/internal/service/safefetch"
	"github.com/akagiyui/oh-my-music-bank/internal/storage/objectstore"
	pkgerrors "github.com/akagiyui/oh-my-music-bank/pkg/errors"
	"github.com/akagiyui/oh-my-music-bank/pkg/response"
)

// 网易云指纹资源存放在私有桶，由后端带鉴权转发给前端，避免公开分发第三方版权二进制。
const (
	afpObjectPrefix = "integrations/netease-afp/"
	afpVersionKey   = "netease.afp.version"
	afpHashKey      = "netease.afp.wasm_sha256"
	afpGlueHashKey  = "netease.afp.glue_sha256"
	afpFetchedKey   = "netease.afp.fetched_at"
	afpVerifyKey    = "netease.afp.verify_hash"
	afpSourceKey    = "netease.afp.source_url"
	afpVerifiedKey  = "netease.afp.verified"
)

var afpAssetContentType = map[string]string{
	recognize.AFPWasmName: "application/wasm",
	recognize.AFPGlueName: "text/javascript; charset=utf-8",
}

// IntegrationsHandler 管理讯飞凭据与网易云指纹资源；哔哩哔哩凭据只由账号登录流程写入。
type IntegrationsHandler struct {
	cache  *cache.Manager
	store  *objectstore.Private
	afpDir string
}

// NewIntegrationsHandler 创建集成配置处理器；afpDir 为镜像内预置指纹资源的目录，可为空。
func NewIntegrationsHandler(c *cache.Manager, store *objectstore.Private, afpDir string) *IntegrationsHandler {
	return &IntegrationsHandler{cache: c, store: store, afpDir: afpDir}
}

// 默认开启哈希校验；只有显式关掉才跳过。
func (h *IntegrationsHandler) afpVerifyEnabled() bool { return h.cache.GetSetting(afpVerifyKey) != "0" }

// bundledAFPPath 返回镜像内预置文件的路径，不存在时返回空串。
func (h *IntegrationsHandler) bundledAFPPath(name string) string {
	if h.afpDir == "" {
		return ""
	}
	path := filepath.Join(h.afpDir, name)
	if info, err := os.Stat(path); err == nil && !info.IsDir() {
		return path
	}
	return ""
}

func (h *IntegrationsHandler) bundledAFPReady() bool {
	return h.bundledAFPPath(recognize.AFPWasmName) != "" && h.bundledAFPPath(recognize.AFPGlueName) != ""
}

// Get 返回集成配置状态（敏感值不回显，只回显是否已配置）。
func (h *IntegrationsHandler) Get(c *gin.Context) {
	response.Success(c, gin.H{
		"xfyunAppId":     h.cache.GetSetting("xfyun.app_id"),
		"xfyunApiKeySet": h.cache.GetSetting("xfyun.api_key") != "",
		"neteaseAfp": gin.H{
			// 管理员拉取的副本优先；没有时回落到镜像内预置的文件。
			"ready":           h.cache.GetSetting(afpHashKey) != "" || h.bundledAFPReady(),
			"source":          h.afpSource(),
			"version":         h.cache.GetSetting(afpVersionKey),
			"wasmSha256":      h.cache.GetSetting(afpHashKey),
			"glueSha256":      h.cache.GetSetting(afpGlueHashKey),
			"fetchedAt":       h.cache.GetSetting(afpFetchedKey),
			"verified":        h.cache.GetSetting(afpVerifiedKey) != "0",
			"verifyHash":      h.afpVerifyEnabled(),
			"sourceUrl":       h.cache.GetSetting(afpSourceKey),
			"extensionId":     recognize.AFPExtensionID,
			"expectedWasmSha": recognize.AFPWasmSHA256,
			"expectedGlueSha": recognize.AFPGlueSHA256,
		},
	})
}

// Update 更新集成配置（字段为 nil 表示不变；空字符串表示清空）。
func (h *IntegrationsHandler) Update(c *gin.Context) {
	var req struct {
		BilibiliCookie *string `json:"bilibiliCookie"`
		XfyunAppID     *string `json:"xfyunAppId"`
		XfyunAPIKey    *string `json:"xfyunApiKey"`
		// 关闭校验或改用自定义地址后，拉进来的就是未经审计的第三方代码，由管理员自负其责。
		NeteaseAfpVerifyHash *bool   `json:"neteaseAfpVerifyHash"`
		NeteaseAfpSourceURL  *string `json:"neteaseAfpSourceUrl"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, pkgerrors.BadRequest(err.Error()))
		return
	}
	values := map[string]string{}
	if req.BilibiliCookie != nil {
		c.JSON(400, pkgerrors.BadRequest("Cookie 导入已替换为扫码登录，请使用哔哩哔哩账号管理"))
		return
	}
	if req.XfyunAppID != nil {
		values["xfyun.app_id"] = *req.XfyunAppID
	}
	if req.XfyunAPIKey != nil {
		values["xfyun.api_key"] = *req.XfyunAPIKey
	}
	if req.NeteaseAfpVerifyHash != nil {
		values[afpVerifyKey] = boolSetting(*req.NeteaseAfpVerifyHash)
	}
	if req.NeteaseAfpSourceURL != nil {
		url := strings.TrimSpace(*req.NeteaseAfpSourceURL)
		if url != "" {
			if err := safefetch.ValidateURL(url); err != nil {
				c.JSON(400, pkgerrors.BadRequest("自定义下载地址无效: "+err.Error()))
				return
			}
		}
		values[afpSourceKey] = url
	}
	if err := h.cache.SetSettings(values); err != nil {
		c.JSON(500, pkgerrors.Internal("保存失败"))
		return
	}
	response.NoContent(c)
}

func (h *IntegrationsHandler) Test(c *gin.Context) {
	var req struct {
		Provider string `json:"provider"`
	}
	if c.ShouldBindJSON(&req) != nil {
		c.JSON(400, pkgerrors.BadRequest("invalid request"))
		return
	}
	if req.Provider == "bilibili" {
		c.JSON(400, pkgerrors.BadRequest("请使用账号管理中的检查并刷新功能"))
		return
	}
	if req.Provider == "xfyun" {
		_, err := recognize.Xfyun(c.Request.Context(), recognize.XfyunCreds{AppID: h.cache.GetSetting("xfyun.app_id"), APIKey: h.cache.GetSetting("xfyun.api_key")}, make([]byte, 32000))
		if err != nil {
			c.JSON(502, pkgerrors.BadRequest("测试请求未通过: "+err.Error()))
			return
		}
		response.Success(c, gin.H{"message": "讯飞测试请求成功（静音样本）"})
		return
	}
	c.JSON(400, pkgerrors.BadRequest("unknown provider"))
}

// FetchNeteaseAFP 从 Chrome 应用店拉取官方扩展，校验哈希后把指纹资源存入私有桶。
func (h *IntegrationsHandler) FetchNeteaseAFP(c *gin.Context) {
	if h.store == nil {
		c.JSON(http.StatusServiceUnavailable, pkgerrors.New("storage_unavailable", "私有桶不可用"))
		return
	}
	verify := h.afpVerifyEnabled()
	assets, err := recognize.FetchAFPAssets(c.Request.Context(), h.cache.GetSetting(afpSourceKey), verify)
	if err != nil {
		c.JSON(http.StatusBadGateway, pkgerrors.New("afp_fetch_failed", err.Error()))
		return
	}
	files := map[string][]byte{
		recognize.AFPWasmName: assets.Wasm,
		recognize.AFPGlueName: assets.Glue,
	}
	for name, data := range files {
		if err := h.store.Put(c.Request.Context(), afpObjectPrefix+name, bytes.NewReader(data), int64(len(data)), afpAssetContentType[name]); err != nil {
			c.JSON(http.StatusInternalServerError, pkgerrors.Internal("保存指纹资源失败: "+err.Error()))
			return
		}
	}
	// 元数据最后写，任一文件上传失败都不会留下"已就绪"的假状态。
	if err := h.cache.SetSettings(map[string]string{
		afpVersionKey:  assets.Version,
		afpHashKey:     assets.WasmHash,
		afpGlueHashKey: assets.GlueHash,
		afpVerifiedKey: boolSetting(assets.Verified),
		afpFetchedKey:  time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal("保存失败"))
		return
	}
	response.Success(c, gin.H{
		"version":    assets.Version,
		"wasmSha256": assets.WasmHash,
		"glueSha256": assets.GlueHash,
		"wasmSize":   len(assets.Wasm),
		"glueSize":   len(assets.Glue),
		"verified":   assets.Verified,
	})
}

// NeteaseAFPAsset 带鉴权转发指纹资源，前端在 Worker 里加载。
func (h *IntegrationsHandler) NeteaseAFPAsset(c *gin.Context) {
	name := c.Param("name")
	contentType, ok := afpAssetContentType[name]
	if !ok {
		c.JSON(http.StatusNotFound, pkgerrors.NotFound("未知的指纹资源"))
		return
	}
	c.Header("Cache-Control", "private, max-age=3600")
	if h.cache.GetSetting(afpHashKey) != "" && h.store != nil {
		rc, err := h.store.Get(c.Request.Context(), afpObjectPrefix+name)
		if err != nil {
			c.JSON(http.StatusNotFound, pkgerrors.NotFound("指纹资源缺失，请重新拉取"))
			return
		}
		defer rc.Close()
		c.DataFromReader(http.StatusOK, -1, contentType, rc, nil)
		return
	}
	if path := h.bundledAFPPath(name); path != "" {
		c.Header("Content-Type", contentType)
		c.File(path)
		return
	}
	c.JSON(http.StatusNotFound, pkgerrors.NotFound("尚未拉取网易云指纹资源"))
}

// DeleteNeteaseAFP 移除本站保存的指纹资源。
func (h *IntegrationsHandler) DeleteNeteaseAFP(c *gin.Context) {
	if h.store != nil {
		for name := range afpAssetContentType {
			_ = h.store.Remove(c.Request.Context(), afpObjectPrefix+name)
		}
	}
	if err := h.cache.SetSettings(map[string]string{afpVersionKey: "", afpHashKey: "", afpGlueHashKey: "", afpFetchedKey: ""}); err != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal("保存失败"))
		return
	}
	response.NoContent(c)
}

// afpSource 指出当前生效的指纹资源来自哪里。
func (h *IntegrationsHandler) afpSource() string {
	if h.cache.GetSetting(afpHashKey) != "" {
		return "fetched"
	}
	if h.bundledAFPReady() {
		return "bundled"
	}
	return ""
}

func boolSetting(v bool) string {
	if v {
		return "1"
	}
	return "0"
}
