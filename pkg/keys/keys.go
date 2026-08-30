// Package keys 负责 API 密钥的生成、哈希与前缀提取。
//
// 安全约定：数据库只存密钥的 SHA-256，明文仅在创建时返回给用户一次。
package keys

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

// Prefix 所有密钥的统一前缀。
const Prefix = "omb_"

// prefixDisplayLen 入库展示前缀的长度（含 Prefix）。
const prefixDisplayLen = 12

// Generate 生成一个新的明文 API Key，如 omb_<48hex>。
func Generate() (string, error) {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return Prefix + hex.EncodeToString(b), nil
}

// Hash 计算明文 key 的 SHA-256（hex）。
func Hash(plain string) string {
	sum := sha256.Sum256([]byte(plain))
	return hex.EncodeToString(sum[:])
}

// DisplayPrefix 取前缀用于展示与快速定位。
func DisplayPrefix(plain string) string {
	if len(plain) < prefixDisplayLen {
		return plain
	}
	return plain[:prefixDisplayLen]
}

// HasValidPrefix 判断字符串是否为本系统密钥格式。
func HasValidPrefix(s string) bool {
	return strings.HasPrefix(s, Prefix)
}
