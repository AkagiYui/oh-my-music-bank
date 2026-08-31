// Package metadata 接入网易云的公开元信息接口（搜索/详情/歌词），用于补全曲目元信息。
// 这些接口为明文 GET，无需加密。
package metadata

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// SongMeta 曲目元信息。
type SongMeta struct {
	ID         string   `json:"id"`
	Title      string   `json:"title"`
	Artists    []string `json:"artists"`
	Album      string   `json:"album"`
	CoverURL   string   `json:"coverUrl,omitempty"`
	DurationMs int      `json:"durationMs"`
	Lyric      string   `json:"lyric,omitempty"`
	LRC        string   `json:"lrc,omitempty"`
}

var httpClient = &http.Client{Timeout: 20 * time.Second}

func get(ctx context.Context, rawURL string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36")
	req.Header.Set("Referer", "https://music.163.com/")
	req.Header.Set("Cookie", "os=pc;")
	resp, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("元数据服务返回 HTTP %d", resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// Search 按关键词搜索网易云曲目。
func Search(ctx context.Context, keyword string) ([]SongMeta, error) {
	u := "https://music.163.com/api/search/get/web?type=1&offset=0&total=true&limit=20&s=" + url.QueryEscape(keyword)
	var r struct {
		Result struct {
			Songs []struct {
				ID      int64  `json:"id"`
				Name    string `json:"name"`
				Artists []struct {
					Name string `json:"name"`
				} `json:"artists"`
				Album struct {
					Name   string `json:"name"`
					PicURL string `json:"picUrl"`
				} `json:"album"`
				Duration int `json:"duration"`
			} `json:"songs"`
		} `json:"result"`
	}
	if err := get(ctx, u, &r); err != nil {
		return nil, err
	}
	out := make([]SongMeta, 0, len(r.Result.Songs))
	for _, s := range r.Result.Songs {
		names := make([]string, 0, len(s.Artists))
		for _, a := range s.Artists {
			names = append(names, a.Name)
		}
		out = append(out, SongMeta{
			ID: fmt.Sprintf("%d", s.ID), Title: s.Name, Artists: names,
			Album: s.Album.Name, CoverURL: s.Album.PicURL, DurationMs: s.Duration,
		})
	}
	return out, nil
}

// Detail 获取单曲完整元信息（含歌词）。
func Detail(ctx context.Context, id string) (*SongMeta, error) {
	var dr struct {
		Songs []struct {
			ID      int64  `json:"id"`
			Name    string `json:"name"`
			Artists []struct {
				Name string `json:"name"`
			} `json:"artists"`
			Album struct {
				Name   string `json:"name"`
				PicURL string `json:"picUrl"`
			} `json:"album"`
			Duration int `json:"duration"`
		} `json:"songs"`
	}
	if err := get(ctx, "https://music.163.com/api/song/detail?ids=%5B"+url.QueryEscape(id)+"%5D", &dr); err != nil {
		return nil, err
	}
	if len(dr.Songs) == 0 {
		return nil, fmt.Errorf("song not found")
	}
	s := dr.Songs[0]
	names := make([]string, 0, len(s.Artists))
	for _, a := range s.Artists {
		names = append(names, a.Name)
	}
	meta := &SongMeta{
		ID: fmt.Sprintf("%d", s.ID), Title: s.Name, Artists: names,
		Album: s.Album.Name, CoverURL: s.Album.PicURL, DurationMs: s.Duration,
	}

	var lr struct {
		Lrc struct {
			Lyric string `json:"lyric"`
		} `json:"lrc"`
		Tlyric struct {
			Lyric string `json:"lyric"`
		} `json:"tlyric"`
	}
	if err := get(ctx, "https://music.163.com/api/song/lyric?lv=-1&tv=-1&id="+url.QueryEscape(id), &lr); err == nil {
		meta.LRC = lr.Lrc.Lyric
		meta.Lyric = stripLRC(lr.Lrc.Lyric)
	}
	return meta, nil
}

// stripLRC 把带时间轴的 LRC 转为纯文本歌词。
func stripLRC(lrc string) string {
	if lrc == "" {
		return ""
	}
	var lines []string
	for _, line := range strings.Split(lrc, "\n") {
		for {
			start := strings.IndexByte(line, '[')
			end := strings.IndexByte(line, ']')
			if start != 0 || end <= start {
				break
			}
			line = line[end+1:]
		}
		if s := strings.TrimSpace(line); s != "" {
			lines = append(lines, s)
		}
	}
	return strings.Join(lines, "\n")
}
