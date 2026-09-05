package handler

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/akagiyui/oh-my-music-bank/internal/service/cache"
	"github.com/akagiyui/oh-my-music-bank/internal/service/recognize"
)

// 镜像内预置的指纹资源在没有拉取副本、甚至没有私有桶时也应可用；
// 只读设置缓存，不触库，因此无需 PostgreSQL。
func TestBundledNeteaseAFPServedWithoutFetch(t *testing.T) {
	dir := t.TempDir()
	must(t, os.WriteFile(filepath.Join(dir, recognize.AFPWasmName), []byte("wasm-bytes"), 0o644))
	must(t, os.WriteFile(filepath.Join(dir, recognize.AFPGlueName), []byte("glue-bytes"), 0o644))
	h := NewIntegrationsHandler(cache.New(nil), nil, dir)

	resp := call(t, h.Get, "GET", "/integrations", nil, nil)
	if resp.Code != 200 {
		t.Fatalf("状态查询失败: %d %s", resp.Code, resp.Body.String())
	}
	var status struct {
		Data struct {
			NeteaseAFP struct {
				Ready  bool   `json:"ready"`
				Source string `json:"source"`
			} `json:"neteaseAfp"`
		} `json:"data"`
	}
	must(t, json.Unmarshal(resp.Body.Bytes(), &status))
	if !status.Data.NeteaseAFP.Ready || status.Data.NeteaseAFP.Source != "bundled" {
		t.Fatalf("应报告镜像内预置可用，实际: %+v", status.Data.NeteaseAFP)
	}

	asset := call(t, h.NeteaseAFPAsset, "GET", "/asset", nil, gin.Params{{Key: "name", Value: recognize.AFPWasmName}})
	if asset.Code != 200 || asset.Body.String() != "wasm-bytes" {
		t.Fatalf("应直接返回预置文件，实际: %d %q", asset.Code, asset.Body.String())
	}

	unknown := call(t, h.NeteaseAFPAsset, "GET", "/asset", nil, gin.Params{{Key: "name", Value: "evil.js"}})
	if unknown.Code != 404 {
		t.Fatalf("只允许两个已知文件名，实际: %d", unknown.Code)
	}
}

// 没有预置目录也没有拉取时，状态为未就绪且资源接口返回 404。
func TestNeteaseAFPNotReadyWithoutAssets(t *testing.T) {
	h := NewIntegrationsHandler(cache.New(nil), nil, t.TempDir())
	resp := call(t, h.NeteaseAFPAsset, "GET", "/asset", nil, gin.Params{{Key: "name", Value: recognize.AFPWasmName}})
	if resp.Code != 404 {
		t.Fatalf("未就绪时应 404，实际: %d", resp.Code)
	}
}
