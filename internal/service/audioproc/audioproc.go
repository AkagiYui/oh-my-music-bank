// Package audioproc 用 ffmpeg 做音频裁剪与识别格式转换。
package audioproc

import (
	"bytes"
	"fmt"
	"os/exec"
)

// Trim 截取 [startSec, endSec) 区间到 outPath，尽量保留原始编码（流拷贝）。
// endSec <= startSec 表示截到结尾。
func Trim(inPath, outPath string, startSec, endSec float64) error {
	args := []string{"-y", "-hide_banner", "-loglevel", "error"}
	if startSec > 0 {
		args = append(args, "-ss", fmt.Sprintf("%.3f", startSec))
	}
	args = append(args, "-i", inPath)
	if endSec > startSec {
		args = append(args, "-t", fmt.Sprintf("%.3f", endSec-startSec))
	}
	args = append(args, "-map", "0:a:0?", "-c", "copy", outPath)
	return run(args)
}

// ToPCM16kMono 转成 16kHz 单声道 16bit 原始 PCM（讯飞听歌识曲所需），
// 从 startSec 开始，最多取 maxSec 秒以控制体积（16k*2B ≈ 32KB/s，≤2MB 约 60s）。
func ToPCM16kMono(inPath, outPath string, startSec, maxSec float64) error {
	args := []string{"-y", "-hide_banner", "-loglevel", "error"}
	if startSec > 0 {
		args = append(args, "-ss", fmt.Sprintf("%.3f", startSec))
	}
	args = append(args, "-i", inPath)
	if maxSec > 0 {
		args = append(args, "-t", fmt.Sprintf("%.3f", maxSec))
	}
	args = append(args, "-ac", "1", "-ar", "16000", "-f", "s16le", "-acodec", "pcm_s16le", outPath)
	return run(args)
}

func run(args []string) error {
	cmd := exec.Command("ffmpeg", args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("ffmpeg: %w: %s", err, stderr.String())
	}
	return nil
}
