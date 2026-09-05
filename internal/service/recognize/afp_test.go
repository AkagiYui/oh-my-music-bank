package recognize

import (
	"archive/zip"
	"bytes"
	"encoding/binary"
	"strings"
	"testing"
)

// buildCRX 按 CRX3 布局拼一个测试包：头部内容无关紧要，只要长度字段正确。
func buildCRX(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var zbuf bytes.Buffer
	zw := zip.NewWriter(&zbuf)
	for name, content := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	header := []byte("fake-crx3-header")
	out := []byte("Cr24")
	out = binary.LittleEndian.AppendUint32(out, 3)
	out = binary.LittleEndian.AppendUint32(out, uint32(len(header)))
	out = append(out, header...)
	return append(out, zbuf.Bytes()...)
}

func TestParseAFPCRXRejectsUnknownWasm(t *testing.T) {
	crx := buildCRX(t, map[string]string{
		AFPWasmName:     "not-the-audited-binary",
		AFPGlueName:     "glue",
		"manifest.json": `{"version":"1.0.4"}`,
	})
	_, err := parseAFPPackage(crx, true)
	if err == nil || !strings.Contains(err.Error(), "哈希") {
		t.Fatalf("哈希不符时必须拒绝，实际: %v", err)
	}
}

func TestParseAFPCRXRequiresBothFiles(t *testing.T) {
	crx := buildCRX(t, map[string]string{AFPWasmName: "x"})
	if _, err := parseAFPPackage(crx, true); err == nil || !strings.Contains(err.Error(), AFPGlueName) {
		t.Fatalf("缺少胶水文件时必须报错，实际: %v", err)
	}
}

func TestCRXPayloadRejectsBadContainer(t *testing.T) {
	if _, err := crxPayload([]byte("not a crx at all")); err == nil {
		t.Fatal("非 CRX 数据必须拒绝")
	}
	bad := []byte("Cr24")
	bad = binary.LittleEndian.AppendUint32(bad, 9)
	bad = binary.LittleEndian.AppendUint32(bad, 0)
	bad = append(bad, make([]byte, 8)...)
	if _, err := crxPayload(bad); err == nil {
		t.Fatal("未知 CRX 版本必须拒绝")
	}
	over := []byte("Cr24")
	over = binary.LittleEndian.AppendUint32(over, 3)
	over = binary.LittleEndian.AppendUint32(over, 1<<30)
	over = append(over, make([]byte, 8)...)
	if _, err := crxPayload(over); err == nil {
		t.Fatal("头部长度越界必须拒绝")
	}
}

func TestCheckAssetPinsContentNotVersion(t *testing.T) {
	const known = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" // sha256("abc")
	hash, err := checkAsset("x.wasm", []byte("abc"), known, true)
	if err != nil || hash != known {
		t.Fatalf("内容一致时应通过，实际 hash=%s err=%v", hash, err)
	}
	_, err = checkAsset("x.wasm", []byte("abc"), "deadbeef", true)
	if err == nil {
		t.Fatal("内容不一致必须拒绝")
	}
	// 报错要带上实际哈希，人工复核后才能更新固定值。
	if !strings.Contains(err.Error(), known) || !strings.Contains(err.Error(), "x.wasm") {
		t.Fatalf("错误信息需包含文件名与实际哈希，实际: %v", err)
	}
}

func TestParseAFPPackageSkipsVerificationWhenDisabled(t *testing.T) {
	crx := buildCRX(t, map[string]string{
		AFPWasmName:     "not-the-audited-binary",
		AFPGlueName:     "glue",
		"manifest.json": `{"version":"9.9.9"}`,
	})
	assets, err := parseAFPPackage(crx, false)
	if err != nil {
		t.Fatalf("关闭校验后应放行，实际: %v", err)
	}
	if assets.Verified || assets.Version != "9.9.9" || assets.WasmHash == "" || assets.GlueHash == "" {
		t.Fatalf("跳过校验时仍需记录实际哈希与版本，实际: %+v", assets)
	}
}

func TestAFPPayloadAcceptsPlainZip(t *testing.T) {
	crx := buildCRX(t, map[string]string{AFPWasmName: "x", AFPGlueName: "y"})
	zipOnly := crx[12+len("fake-crx3-header"):]
	if _, err := afpPayload(zipOnly); err != nil {
		t.Fatalf("自定义地址可直接提供 zip，实际: %v", err)
	}
	if _, err := afpPayload([]byte("plain text")); err == nil {
		t.Fatal("无法识别的格式必须拒绝")
	}
}
