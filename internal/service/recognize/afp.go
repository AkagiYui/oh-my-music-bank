package recognize

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/akagiyui/oh-my-music-bank/internal/service/safefetch"
)

// 网易云听歌识曲的指纹算法只存在于官方 Chrome 扩展「云音乐听歌」里，
// 本仓库不分发这两个文件，改为按需从 Chrome 应用店拉取官方签名包并校验哈希。
const (
	// AFPExtensionID 官方扩展 ID。
	AFPExtensionID = "kemcalcncfhmdkgglekijclbomdoohkp"
	// AFPWasmSHA256 已审计版本 afp.wasm 的 SHA-256。
	// 应用店只提供扩展的当前版本，无法按版本号拉取，所以这里锁内容而不是锁版本号：
	// 上游一旦改动，拉取直接失败并报出实际哈希，不会静默换掉在管理员浏览器里执行的代码。
	AFPWasmSHA256 = "8064415bb66e45410e88877f07cd007a3ae62ebf463aac13c159a8f13e4c8fe8"
	// AFPGlueSHA256 已审计版本 sandbox.bundle.js 的 SHA-256，同样锁内容。
	AFPGlueSHA256 = "ac38899d27fcc81cbae644bd89ec826ebb865e93c759521ab5c7c8875ed83c1e"
	// AFPWasmName 指纹 wasm 在扩展包内的文件名。
	AFPWasmName = "afp.wasm"
	// AFPGlueName emscripten 胶水，负责加载 wasm 并暴露 ExtractQueryFP。
	AFPGlueName = "sandbox.bundle.js"

	afpCRXMaxSize = 8 << 20

	// NeteaseSegmentSec 网易云指纹的固定窗口长度：8kHz 下恰好 48000 个样点。
	NeteaseSegmentSec = 6
)

// AFPAssets 一次拉取得到的扩展资源。
type AFPAssets struct {
	Wasm     []byte
	Glue     []byte
	Version  string
	WasmHash string
	GlueHash string
	Verified bool
}

// AFPStoreURL 官方应用店下载地址，只能取到扩展的当前版本。
func AFPStoreURL() string {
	return "https://clients2.google.com/service/update2/crx?response=redirect&prodversion=120.0&acceptformat=crx2,crx3&x=id%3D" + AFPExtensionID + "%26uc"
}

// FetchAFPAssets 下载扩展包并取出指纹所需的两个文件。
// sourceURL 为空时用官方应用店；自定义地址走 safefetch 的校验与客户端。
// verify 为假时跳过哈希比对，仍会记录实际哈希，由调用方决定如何提示。
func FetchAFPAssets(ctx context.Context, sourceURL string, verify bool) (*AFPAssets, error) {
	url := AFPStoreURL()
	client := httpClient
	if sourceURL != "" {
		if err := safefetch.ValidateURL(sourceURL); err != nil {
			return nil, err
		}
		url = sourceURL
		client = safefetch.Client()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("下载扩展失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("下载扩展失败: HTTP %d", resp.StatusCode)
	}
	crx, err := io.ReadAll(io.LimitReader(resp.Body, afpCRXMaxSize+1))
	if err != nil {
		return nil, err
	}
	if len(crx) > afpCRXMaxSize {
		return nil, fmt.Errorf("扩展包超过 %d MB 限制", afpCRXMaxSize>>20)
	}
	return parseAFPPackage(crx, verify)
}

// parseAFPPackage 解出扩展包内的两个文件；verify 决定是否比对已审计哈希。
func parseAFPPackage(pkg []byte, verify bool) (*AFPAssets, error) {
	payload, err := afpPayload(pkg)
	if err != nil {
		return nil, err
	}
	zr, err := zip.NewReader(bytes.NewReader(payload), int64(len(payload)))
	if err != nil {
		return nil, fmt.Errorf("扩展包解析失败: %w", err)
	}
	wasm, err := readZipFile(zr, AFPWasmName)
	if err != nil {
		return nil, err
	}
	glue, err := readZipFile(zr, AFPGlueName)
	if err != nil {
		return nil, err
	}
	wasmHash, err := checkAsset(AFPWasmName, wasm, AFPWasmSHA256, verify)
	if err != nil {
		return nil, err
	}
	glueHash, err := checkAsset(AFPGlueName, glue, AFPGlueSHA256, verify)
	if err != nil {
		return nil, err
	}
	version := ""
	if manifest, err := readZipFile(zr, "manifest.json"); err == nil {
		var m struct {
			Version string `json:"version"`
		}
		if json.Unmarshal(manifest, &m) == nil {
			version = m.Version
		}
	}
	return &AFPAssets{Wasm: wasm, Glue: glue, Version: version, WasmHash: wasmHash, GlueHash: glueHash, Verified: verify}, nil
}

// checkAsset 计算内容哈希；verify 为真时不一致即拒绝，并报出实际值便于人工复核。
func checkAsset(name string, data []byte, expected string, verify bool) (string, error) {
	sum := sha256.Sum256(data)
	hash := hex.EncodeToString(sum[:])
	if verify && hash != expected {
		return "", fmt.Errorf("%s 哈希与已审计版本不一致（实际 %s，预期 %s），扩展可能已更新，请重新审计后再更新固定哈希", name, hash, expected)
	}
	return hash, nil
}

// afpPayload 兼容官方 CRX 与直接提供的 zip 包（解包后的扩展重新打包也可用）。
func afpPayload(pkg []byte) ([]byte, error) {
	if len(pkg) >= 4 && string(pkg[:4]) == "Cr24" {
		return crxPayload(pkg)
	}
	if len(pkg) >= 2 && string(pkg[:2]) == "PK" {
		return pkg, nil
	}
	return nil, fmt.Errorf("无法识别的包格式，应为 CRX 或 ZIP")
}

// crxPayload 去掉 CRX2/CRX3 头，返回内嵌的 zip 数据。
func crxPayload(crx []byte) ([]byte, error) {
	if len(crx) < 16 || string(crx[:4]) != "Cr24" {
		return nil, fmt.Errorf("不是有效的 CRX 包")
	}
	version := binary.LittleEndian.Uint32(crx[4:8])
	var offset uint64
	switch version {
	case 3:
		offset = 12 + uint64(binary.LittleEndian.Uint32(crx[8:12]))
	case 2:
		offset = 16 + uint64(binary.LittleEndian.Uint32(crx[8:12])) + uint64(binary.LittleEndian.Uint32(crx[12:16]))
	default:
		return nil, fmt.Errorf("不支持的 CRX 版本 %d", version)
	}
	if offset > uint64(len(crx)) {
		return nil, fmt.Errorf("CRX 头部长度异常")
	}
	return crx[offset:], nil
}

func readZipFile(zr *zip.Reader, name string) ([]byte, error) {
	for _, f := range zr.File {
		if f.Name != name {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return nil, err
		}
		defer rc.Close()
		return io.ReadAll(io.LimitReader(rc, afpCRXMaxSize))
	}
	return nil, fmt.Errorf("扩展包内缺少 %s", name)
}
