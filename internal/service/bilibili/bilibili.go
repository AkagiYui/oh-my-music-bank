// Package bilibili 封装从哔哩哔哩拉取收藏夹、视频信息与 DASH 音频流所需的 Web API。
//
// 鉴权使用管理员提供的 Cookie（SESSDATA 等）。部分接口需 WBI 签名。
// 音频 CDN 地址下载需带 Referer，浏览器无法直连，故由后端代理流式转发。
package bilibili

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
	referer   = "https://www.bilibili.com"
	apiBase   = "https://api.bilibili.com"
)

// mixinKeyEncTab 是 WBI 签名的 64 位混淆下标表（与 yt-dlp 实现一致）。
var mixinKeyEncTab = []int{
	46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
	33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
	61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
	36, 20, 34, 44, 52,
}

// Client 是哔哩哔哩 API 客户端，缓存 WBI 密钥。
type Client struct {
	hc  *http.Client
	mu  sync.Mutex
	img string
	sub string
	at  time.Time
}

// New 创建客户端。
func New() *Client {
	return &Client{hc: &http.Client{Timeout: 60 * time.Second}}
}

// ---- 数据结构 ----

// FavFolder 收藏夹。
type FavFolder struct {
	ID         int64  `json:"id"`
	Title      string `json:"title"`
	MediaCount int    `json:"mediaCount"`
}

// FavMedia 收藏夹中的视频。
type FavMedia struct {
	BVID     string `json:"bvid"`
	Title    string `json:"title"`
	Cover    string `json:"cover"`
	Duration int    `json:"duration"`
	Pages    int    `json:"pages"`
	UpName   string `json:"upName"`
}

// VideoPage 分 P。
type VideoPage struct {
	CID      int64  `json:"cid"`
	Page     int    `json:"page"`
	Part     string `json:"part"`
	Duration int    `json:"duration"`
}

// VideoInfo 视频信息。
type VideoInfo struct {
	AID   int64       `json:"aid"`
	BVID  string      `json:"bvid"`
	Title string      `json:"title"`
	Cover string      `json:"cover"`
	Owner string      `json:"owner"`
	Pages []VideoPage `json:"pages"`
}

// AudioStream 一路 DASH 音频。
type AudioStream struct {
	URL       string
	BackupURL []string
	Bandwidth int
	Codecs    string
}

// ---- 内部请求 ----

func (c *Client) doJSON(ctx context.Context, cookie, fullURL string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fullURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Referer", referer)
	if cookie != "" {
		req.Header.Set("Cookie", cookie)
	}
	resp, err := c.hc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("bilibili http %d", resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// envelope 是哔哩哔哩统一响应外壳。
type envelope struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data"`
}

func (c *Client) getData(ctx context.Context, cookie, fullURL string) (json.RawMessage, error) {
	var env envelope
	if err := c.doJSON(ctx, cookie, fullURL, &env); err != nil {
		return nil, err
	}
	if env.Code != 0 {
		return nil, fmt.Errorf("bilibili code %d: %s", env.Code, env.Message)
	}
	return env.Data, nil
}

// ---- WBI 签名 ----

func (c *Client) wbiKeys(ctx context.Context, cookie string) (string, string, error) {
	c.mu.Lock()
	if c.img != "" && time.Since(c.at) < 6*time.Hour {
		img, sub := c.img, c.sub
		c.mu.Unlock()
		return img, sub, nil
	}
	c.mu.Unlock()

	data, err := c.getData(ctx, cookie, apiBase+"/x/web-interface/nav")
	if err != nil {
		return "", "", err
	}
	var nav struct {
		WbiImg struct {
			ImgURL string `json:"img_url"`
			SubURL string `json:"sub_url"`
		} `json:"wbi_img"`
	}
	if err := json.Unmarshal(data, &nav); err != nil {
		return "", "", err
	}
	img := keyFromURL(nav.WbiImg.ImgURL)
	sub := keyFromURL(nav.WbiImg.SubURL)
	if img == "" || sub == "" {
		return "", "", fmt.Errorf("bilibili: empty wbi keys")
	}
	c.mu.Lock()
	c.img, c.sub, c.at = img, sub, time.Now()
	c.mu.Unlock()
	return img, sub, nil
}

func keyFromURL(u string) string {
	base := u[strings.LastIndex(u, "/")+1:]
	if i := strings.IndexByte(base, '.'); i >= 0 {
		base = base[:i]
	}
	return base
}

func mixinKey(img, sub string) string {
	raw := img + sub
	var b strings.Builder
	for _, i := range mixinKeyEncTab {
		if i < len(raw) {
			b.WriteByte(raw[i])
		}
	}
	s := b.String()
	if len(s) > 32 {
		s = s[:32]
	}
	return s
}

// signWBI 给参数加上 wts/w_rid 并返回完整查询串。
func signWBI(params url.Values, mk string) string {
	params.Set("wts", fmt.Sprintf("%d", time.Now().Unix()))
	keys := make([]string, 0, len(params))
	for k := range params {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var parts []string
	for _, k := range keys {
		v := params.Get(k)
		v = strings.NewReplacer("!", "", "'", "", "(", "", ")", "", "*", "").Replace(v)
		parts = append(parts, url.QueryEscape(k)+"="+url.QueryEscape(v))
	}
	q := strings.Join(parts, "&")
	sum := md5.Sum([]byte(q + mk))
	return q + "&w_rid=" + hex.EncodeToString(sum[:])
}

// ---- 公开方法 ----

// SelfMID 返回当前登录用户 mid。
func (c *Client) SelfMID(ctx context.Context, cookie string) (int64, error) {
	data, err := c.getData(ctx, cookie, apiBase+"/x/web-interface/nav")
	if err != nil {
		return 0, err
	}
	var nav struct {
		Mid int64 `json:"mid"`
	}
	if err := json.Unmarshal(data, &nav); err != nil {
		return 0, err
	}
	return nav.Mid, nil
}

// FavFolders 列出用户创建的收藏夹。
func (c *Client) FavFolders(ctx context.Context, cookie string) ([]FavFolder, error) {
	mid, err := c.SelfMID(ctx, cookie)
	if err != nil {
		return nil, err
	}
	u := fmt.Sprintf("%s/x/v3/fav/folder/created/list-all?up_mid=%d&type=2", apiBase, mid)
	data, err := c.getData(ctx, cookie, u)
	if err != nil {
		return nil, err
	}
	var d struct {
		List []struct {
			ID         int64  `json:"id"`
			Title      string `json:"title"`
			MediaCount int    `json:"media_count"`
		} `json:"list"`
	}
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, err
	}
	out := make([]FavFolder, 0, len(d.List))
	for _, f := range d.List {
		out = append(out, FavFolder{ID: f.ID, Title: f.Title, MediaCount: f.MediaCount})
	}
	return out, nil
}

// FavResources 分页列出收藏夹中的视频。
func (c *Client) FavResources(ctx context.Context, cookie string, mediaID int64, pn int) ([]FavMedia, bool, error) {
	if pn < 1 {
		pn = 1
	}
	u := fmt.Sprintf("%s/x/v3/fav/resource/list?media_id=%d&pn=%d&ps=20&platform=web&order=mtime", apiBase, mediaID, pn)
	data, err := c.getData(ctx, cookie, u)
	if err != nil {
		return nil, false, err
	}
	var d struct {
		HasMore bool `json:"has_more"`
		Medias  []struct {
			BVID     string `json:"bvid"`
			Type     int    `json:"type"`
			Title    string `json:"title"`
			Cover    string `json:"cover"`
			Duration int    `json:"duration"`
			Page     int    `json:"page"`
			Upper    struct {
				Name string `json:"name"`
			} `json:"upper"`
		} `json:"medias"`
	}
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, false, err
	}
	out := make([]FavMedia, 0, len(d.Medias))
	for _, m := range d.Medias {
		if m.Type != 2 {
			continue // 仅普通视频
		}
		out = append(out, FavMedia{
			BVID: m.BVID, Title: m.Title, Cover: m.Cover,
			Duration: m.Duration, Pages: m.Page, UpName: m.Upper.Name,
		})
	}
	return out, d.HasMore, nil
}

// View 获取视频信息（含分 P 的 cid）。
func (c *Client) View(ctx context.Context, cookie, bvid string) (*VideoInfo, error) {
	u := fmt.Sprintf("%s/x/web-interface/view?bvid=%s", apiBase, url.QueryEscape(bvid))
	data, err := c.getData(ctx, cookie, u)
	if err != nil {
		return nil, err
	}
	var d struct {
		AID   int64  `json:"aid"`
		BVID  string `json:"bvid"`
		Title string `json:"title"`
		Pic   string `json:"pic"`
		Owner struct {
			Name string `json:"name"`
		} `json:"owner"`
		Pages []struct {
			CID      int64  `json:"cid"`
			Page     int    `json:"page"`
			Part     string `json:"part"`
			Duration int    `json:"duration"`
		} `json:"pages"`
	}
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, err
	}
	info := &VideoInfo{AID: d.AID, BVID: d.BVID, Title: d.Title, Cover: d.Pic, Owner: d.Owner.Name}
	for _, p := range d.Pages {
		info.Pages = append(info.Pages, VideoPage{CID: p.CID, Page: p.Page, Part: p.Part, Duration: p.Duration})
	}
	return info, nil
}

// dashAudio 兼容 camelCase 与 snake_case 两种字段。
type dashAudio struct {
	ID         int      `json:"id"`
	BaseURL    string   `json:"baseUrl"`
	BaseURLS   string   `json:"base_url"`
	BackupURL  []string `json:"backupUrl"`
	BackupURLS []string `json:"backup_url"`
	Bandwidth  int      `json:"bandwidth"`
	Codecs     string   `json:"codecs"`
}

func (a dashAudio) url() string {
	if a.BaseURL != "" {
		return a.BaseURL
	}
	return a.BaseURLS
}
func (a dashAudio) backups() []string {
	if len(a.BackupURL) > 0 {
		return a.BackupURL
	}
	return a.BackupURLS
}

// BestAudio 取最佳音质音频流（优先无损 FLAC，否则最高码率）。
func (c *Client) BestAudio(ctx context.Context, cookie, bvid string, cid int64) (*AudioStream, error) {
	img, sub, err := c.wbiKeys(ctx, cookie)
	if err != nil {
		return nil, err
	}
	params := url.Values{}
	params.Set("bvid", bvid)
	params.Set("cid", fmt.Sprintf("%d", cid))
	params.Set("fnval", "4048")
	params.Set("fourk", "1")
	params.Set("fnver", "0")
	params.Set("platform", "pc")
	params.Set("otype", "json")
	q := signWBI(params, mixinKey(img, sub))

	data, err := c.getData(ctx, cookie, apiBase+"/x/player/wbi/playurl?"+q)
	if err != nil {
		return nil, err
	}
	var d struct {
		Dash struct {
			Audio []dashAudio `json:"audio"`
			Flac  *struct {
				Audio *dashAudio `json:"audio"`
			} `json:"flac"`
		} `json:"dash"`
	}
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, err
	}
	if d.Dash.Flac != nil && d.Dash.Flac.Audio != nil && d.Dash.Flac.Audio.url() != "" {
		a := d.Dash.Flac.Audio
		return &AudioStream{URL: a.url(), BackupURL: a.backups(), Bandwidth: a.Bandwidth, Codecs: a.Codecs}, nil
	}
	var best *dashAudio
	for i := range d.Dash.Audio {
		if best == nil || d.Dash.Audio[i].Bandwidth > best.Bandwidth {
			best = &d.Dash.Audio[i]
		}
	}
	if best == nil {
		return nil, fmt.Errorf("bilibili: no audio stream")
	}
	return &AudioStream{URL: best.url(), BackupURL: best.backups(), Bandwidth: best.Bandwidth, Codecs: best.Codecs}, nil
}

// FetchAudio 向音频 CDN 发起带 Referer 的请求（可携带 Range），返回响应供后端流式转发或下载。
func (c *Client) FetchAudio(ctx context.Context, audioURL, rangeHeader string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, audioURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Referer", referer)
	if rangeHeader != "" {
		req.Header.Set("Range", rangeHeader)
	}
	return c.hc.Do(req)
}

// Download 将音频流完整下载到 w。
func (c *Client) Download(ctx context.Context, audioURL string, w io.Writer) error {
	resp, err := c.FetchAudio(ctx, audioURL, "")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent {
		return fmt.Errorf("bilibili audio http %d", resp.StatusCode)
	}
	n, err := io.Copy(w, io.LimitReader(resp.Body, (2<<30)+1))
	if n > 2<<30 {
		return fmt.Errorf("音频超过 2GB 限制")
	}
	return err
}
