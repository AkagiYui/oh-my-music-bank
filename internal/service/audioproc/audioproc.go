package audioproc

import (
	"bytes"
	"context"
	"fmt"
	"math"
	"os/exec"
	"time"
)

var slots = make(chan struct{}, 2)

// 所有探测和转码共享并发上限，取消请求或任务时会终止子进程。
func Command(ctx context.Context, name string, args ...string) ([]byte, []byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Minute)
	defer cancel()
	select {
	case slots <- struct{}{}:
	case <-ctx.Done():
		return nil, nil, ctx.Err()
	}
	defer func() { <-slots }()
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.WaitDelay = 5 * time.Second
	var stdout, stderr cappedBuffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	if err != nil {
		return nil, stderr.Bytes(), fmt.Errorf("%s 执行失败: %w", name, err)
	}
	return stdout.Bytes(), stderr.Bytes(), nil
}
func ValidateSegment(start, end, duration float64) error {
	if math.IsNaN(start) || math.IsNaN(end) || math.IsInf(start, 0) || math.IsInf(end, 0) || start < 0 || end < 0 {
		return fmt.Errorf("无效的片段范围")
	}
	if end > 0 && end <= start {
		return fmt.Errorf("结束时间必须晚于开始时间")
	}
	if duration > 0 && (start >= duration || end > duration+0.5) {
		return fmt.Errorf("片段超出音频范围")
	}
	return nil
}
func Trim(ctx context.Context, inPath, outPath string, startSec, endSec float64) error {
	if err := ValidateSegment(startSec, endSec, 0); err != nil {
		return err
	}
	args := []string{"-y", "-nostdin", "-hide_banner", "-loglevel", "error"}
	if startSec > 0 {
		args = append(args, "-ss", fmt.Sprintf("%.3f", startSec))
	}
	args = append(args, "-i", inPath)
	if endSec > 0 {
		args = append(args, "-t", fmt.Sprintf("%.3f", endSec-startSec))
	}
	args = append(args, "-map", "0:a:0", "-c", "copy", outPath)
	_, _, err := Command(ctx, "ffmpeg", args...)
	return err
}
func ToPCM16kMono(ctx context.Context, inPath, outPath string, startSec, maxSec float64) error {
	if err := ValidateSegment(startSec, startSec+maxSec, 0); err != nil {
		return err
	}
	args := []string{"-y", "-nostdin", "-hide_banner", "-loglevel", "error", "-ss", fmt.Sprintf("%.3f", startSec), "-i", inPath, "-t", fmt.Sprintf("%.3f", maxSec), "-ac", "1", "-ar", "16000", "-f", "s16le", "-acodec", "pcm_s16le", outPath}
	_, _, err := Command(ctx, "ffmpeg", args...)
	return err
}

// ToPCMFloat8kMono 输出 8kHz 单声道 32 位浮点裸 PCM，供网易云 afp 指纹使用。
// 网易扩展用 AudioContext({sampleRate:8000}) 取样，指纹算法只认这个格式；
// 指纹要求满 maxSec 的样点，素材不足时用 apad 补静音，保证输出长度固定。
func ToPCMFloat8kMono(ctx context.Context, inPath, outPath string, startSec, maxSec float64) error {
	if err := ValidateSegment(startSec, startSec+maxSec, 0); err != nil {
		return err
	}
	args := []string{"-y", "-nostdin", "-hide_banner", "-loglevel", "error", "-ss", fmt.Sprintf("%.3f", startSec), "-i", inPath, "-af", "apad", "-t", fmt.Sprintf("%.3f", maxSec), "-ac", "1", "-ar", "8000", "-f", "f32le", "-acodec", "pcm_f32le", outPath}
	_, _, err := Command(ctx, "ffmpeg", args...)
	return err
}

// 限制工具输出内存占用；仍消费全部输出，避免子进程因管道阻塞而挂起。
type cappedBuffer struct{ bytes.Buffer }

func (b *cappedBuffer) Write(p []byte) (int, error) {
	n := len(p)
	remaining := (4 << 20) - b.Len()
	if remaining > 0 {
		if len(p) > remaining {
			p = p[:remaining]
		}
		_, _ = b.Buffer.Write(p)
	}
	return n, nil
}
