// Package recognize 适配国内听歌识曲服务（讯飞 / 网易云）。
//
// 讯飞 qbh 为可直接调用的 HTTP API（已实现）。
// 网易云识别依赖其专有指纹（afp.wasm），纯 Go 无法复现，这里实现了 match 请求，
// 但指纹需由外部指纹后端提供；未配置时返回明确错误。
package recognize

import (
	"bytes"
	"context"
	"crypto/md5"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Candidate 一条识别候选。
type Candidate struct {
	Title    string `json:"title"`
	Artist   string `json:"artist"`
	Source   string `json:"source"`
	SongID   string `json:"songId,omitempty"`
	SingerID string `json:"singerId,omitempty"`
}

var httpClient = &http.Client{Timeout: 30 * time.Second}

// ---- 讯飞 qbh ----

// XfyunCreds 讯飞凭据。
type XfyunCreds struct {
	AppID  string
	APIKey string
}

// Xfyun 调用讯飞听歌识曲。audio 为 16k 单声道 16bit 原始 PCM（≤2MB）。
func Xfyun(ctx context.Context, creds XfyunCreds, audio []byte) ([]Candidate, error) {
	if creds.AppID == "" || creds.APIKey == "" {
		return nil, fmt.Errorf("讯飞 AppID/APIKey 未配置")
	}
	if len(audio) > 2<<20 {
		return nil, fmt.Errorf("音频超过 2MB 限制")
	}

	paramJSON, _ := json.Marshal(map[string]string{
		"engine_type": "afs",
		"aue":         "raw",
		"sample_rate": "16000",
	})
	xParam := base64.StdEncoding.EncodeToString(paramJSON)
	curTime := fmt.Sprintf("%d", time.Now().Unix())
	sum := md5.Sum([]byte(creds.APIKey + curTime + xParam))
	checksum := hex.EncodeToString(sum[:])

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		xfyunEndpoint, bytes.NewReader(audio))
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Appid", creds.AppID)
	req.Header.Set("X-CurTime", curTime)
	req.Header.Set("X-Param", xParam)
	req.Header.Set("X-CheckSum", checksum)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded; charset=utf-8")

	resp, err := xfyunHTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	var r struct {
		Code string `json:"code"`
		Desc string `json:"desc"`
		Data []struct {
			Song     string `json:"song"`
			SongID   string `json:"song_id"`
			Singer   string `json:"singer"`
			SingerID string `json:"singer_id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &r); err != nil {
		return nil, fmt.Errorf("讯飞响应解析失败: %s", string(body))
	}
	if r.Code != "0" {
		return nil, fmt.Errorf("讯飞识别失败 [%s] %s", r.Code, r.Desc)
	}
	out := make([]Candidate, 0, len(r.Data))
	for _, d := range r.Data {
		out = append(out, Candidate{
			Title: d.Song, Artist: d.Singer, Source: "xfyun",
			SongID: d.SongID, SingerID: d.SingerID,
		})
	}
	return out, nil
}

// ---- 网易云 match ----

// NeteaseMatch 用已生成的 base64 指纹请求网易云识别。
// 指纹（algorithmCode=shazam_v2）需由专有 afp 指纹后端生成，本仓库不含该后端。
func NeteaseMatch(ctx context.Context, fingerprintB64 string, durationSec int) ([]Candidate, error) {
	if fingerprintB64 == "" {
		return nil, fmt.Errorf("网易云识别需要 afp 指纹后端（afp.wasm），当前未配置")
	}
	form := url.Values{}
	form.Set("sessionId", randomUUID())
	form.Set("algorithmCode", "shazam_v2")
	form.Set("duration", fmt.Sprintf("%d", durationSec))
	form.Set("rawdata", fingerprintB64)
	form.Set("times", "2")
	form.Set("decrypt", "1")

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://interface.music.163.com/api/music/audio/match", strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/102.0.0.0 Safari/537.36")

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var r struct {
		Data struct {
			Result []struct {
				Song struct {
					ID      int64  `json:"id"`
					Name    string `json:"name"`
					Artists []struct {
						Name string `json:"name"`
					} `json:"artists"`
				} `json:"song"`
			} `json:"result"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&r); err != nil {
		return nil, err
	}
	out := make([]Candidate, 0, len(r.Data.Result))
	for _, m := range r.Data.Result {
		names := make([]string, 0, len(m.Song.Artists))
		for _, a := range m.Song.Artists {
			names = append(names, a.Name)
		}
		out = append(out, Candidate{
			Title: m.Song.Name, Artist: strings.Join(names, " / "),
			Source: "netease", SongID: fmt.Sprintf("%d", m.Song.ID),
		})
	}
	return out, nil
}

func randomUUID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
