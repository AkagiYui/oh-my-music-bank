// Package audiometa 解析音频文件的标签与技术参数。
//
// 标签（标题/艺术家/专辑/歌词/封面）使用 github.com/dhowden/tag；
// 技术参数（时长/码率/采样率/声道/位深/编码器）调用 ffprobe（需镜像内置 ffmpeg）。
// ffprobe 缺失或失败时仅技术字段留零，不影响标签解析与上传流程。
package audiometa

import (
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"

	"github.com/dhowden/tag"
)

// Meta 解析得到的音频元数据。
type Meta struct {
	Title  string
	Artist string
	Album  string
	Lyric  string

	HasCover  bool
	CoverData []byte
	CoverMime string

	Duration     int // 秒
	Bitrate      int // bps
	ChannelCount int
	SamplingRate int // Hz
	BitDepth     int // bit，有损格式通常为 0
	Format       string
	Encoder      string

	Loudness *float64 // 集成响度（LUFS，EBU R128），解析失败为 nil
}

// Parse 解析指定路径的音频文件（标签 + 技术参数 + 响度，均 best-effort）。
func Parse(path string) (*Meta, error) {
	meta := &Meta{}
	parseTags(path, meta)
	parseFFprobe(path, meta)
	meta.Loudness = measureLoudness(path)
	return meta, nil
}

// loudnormInputI 匹配 ffmpeg loudnorm print_format=json 输出中的 input_i 字段。
var loudnormInputI = regexp.MustCompile(`"input_i"\s*:\s*"(-?[0-9.]+)"`)

// measureLoudness 用 ffmpeg 的 loudnorm 滤镜测量集成响度（LUFS）。
// 需要一次完整解码，耗时较长；ffmpeg 缺失或静音（-inf）时返回 nil。
func measureLoudness(path string) *float64 {
	cmd := exec.Command("ffmpeg", "-hide_banner", "-nostats",
		"-i", path, "-af", "loudnorm=print_format=json", "-f", "null", "-")
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	// loudnorm 把 JSON 打到 stderr；即使退出码非零也尝试解析。
	_ = cmd.Run()

	m := loudnormInputI.FindStringSubmatch(stderr.String())
	if m == nil {
		return nil
	}
	v, err := strconv.ParseFloat(m[1], 64)
	if err != nil {
		return nil
	}
	return &v
}

// parseTags 读取内嵌标签，best-effort。
func parseTags(path string, meta *Meta) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()

	m, err := tag.ReadFrom(f)
	if err != nil {
		return
	}
	meta.Title = m.Title()
	meta.Artist = m.Artist()
	meta.Album = m.Album()
	meta.Lyric = m.Lyrics()
	if meta.Format == "" {
		meta.Format = string(m.FileType())
	}
	if pic := m.Picture(); pic != nil && len(pic.Data) > 0 {
		meta.HasCover = true
		meta.CoverData = pic.Data
		meta.CoverMime = pic.MIMEType
	}
}

// ffprobeOutput 对应 ffprobe -print_format json 的部分字段。
type ffprobeOutput struct {
	Streams []struct {
		CodecType     string `json:"codec_type"`
		CodecName     string `json:"codec_name"`
		SampleRate    string `json:"sample_rate"`
		Channels      int    `json:"channels"`
		BitsPerSample int    `json:"bits_per_sample"`
		BitsPerRaw    string `json:"bits_per_raw_sample"`
		BitRate       string `json:"bit_rate"`
	} `json:"streams"`
	Format struct {
		FormatName string            `json:"format_name"`
		Duration   string            `json:"duration"`
		BitRate    string            `json:"bit_rate"`
		Tags       map[string]string `json:"tags"`
	} `json:"format"`
}

// parseFFprobe 用 ffprobe 提取技术参数，best-effort。
func parseFFprobe(path string, meta *Meta) {
	out, err := exec.Command("ffprobe",
		"-v", "quiet",
		"-print_format", "json",
		"-show_format",
		"-show_streams",
		path,
	).Output()
	if err != nil {
		return
	}

	var probe ffprobeOutput
	if err := json.Unmarshal(out, &probe); err != nil {
		return
	}

	if d, err := strconv.ParseFloat(probe.Format.Duration, 64); err == nil {
		meta.Duration = int(d)
	}
	if b, err := strconv.Atoi(probe.Format.BitRate); err == nil {
		meta.Bitrate = b
	}
	if probe.Format.FormatName != "" {
		meta.Format = strings.SplitN(probe.Format.FormatName, ",", 2)[0]
	}
	if enc := probe.Format.Tags["encoder"]; enc != "" {
		meta.Encoder = enc
	}

	for _, st := range probe.Streams {
		if st.CodecType != "audio" {
			continue
		}
		if sr, err := strconv.Atoi(st.SampleRate); err == nil {
			meta.SamplingRate = sr
		}
		if st.Channels > 0 {
			meta.ChannelCount = st.Channels
		}
		if st.BitsPerSample > 0 {
			meta.BitDepth = st.BitsPerSample
		} else if bd, err := strconv.Atoi(st.BitsPerRaw); err == nil {
			meta.BitDepth = bd
		}
		if meta.Bitrate == 0 {
			if b, err := strconv.Atoi(st.BitRate); err == nil {
				meta.Bitrate = b
			}
		}
		if meta.Encoder == "" {
			meta.Encoder = st.CodecName
		}
		break
	}
}
