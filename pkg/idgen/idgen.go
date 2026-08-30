// Package idgen 提供一个简化的雪花（Snowflake）ID 生成器，
// 用于为曲目、艺术家等表分配应用层 bigint 主键（便于跨收录来源去重）。
package idgen

import (
	"sync"
	"time"
)

// 自定义纪元（2024-01-01 UTC），让生成的 ID 在较长时间内保持较小。
const epochMillis int64 = 1704067200000

const (
	seqBits   = 12
	nodeBits  = 10
	seqMask   = -1 ^ (-1 << seqBits)
	nodeShift = seqBits
	tsShift   = seqBits + nodeBits
	maxNodeID = -1 ^ (-1 << nodeBits)
)

// Generator 是并发安全的雪花 ID 生成器。
type Generator struct {
	mu       sync.Mutex
	nodeID   int64
	lastTS   int64
	sequence int64
}

// New 创建一个生成器，nodeID 取值 [0, 1023]，多实例部署时应各不相同。
func New(nodeID int64) *Generator {
	return &Generator{nodeID: nodeID & maxNodeID}
}

// 默认实例（单机部署足够；多实例可通过 SetDefaultNode 区分）。
var defaultGen = New(1)

// SetDefaultNode 设置默认生成器的节点号。
func SetDefaultNode(nodeID int64) { defaultGen = New(nodeID) }

// Next 返回一个全局递增、近似时间有序的 ID。
func Next() int64 { return defaultGen.Next() }

// Next 生成下一个 ID。
func (g *Generator) Next() int64 {
	g.mu.Lock()
	defer g.mu.Unlock()

	now := time.Now().UnixMilli()
	if now == g.lastTS {
		g.sequence = (g.sequence + 1) & seqMask
		if g.sequence == 0 {
			// 当前毫秒序列耗尽，自旋到下一毫秒。
			for now <= g.lastTS {
				now = time.Now().UnixMilli()
			}
		}
	} else {
		g.sequence = 0
	}
	g.lastTS = now

	return ((now - epochMillis) << tsShift) | (g.nodeID << nodeShift) | g.sequence
}
