package bilibili

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"

	"golang.org/x/net/html"
)

const passportBase = "https://passport.bilibili.com"

var ErrLoginExpired = errors.New("哔哩哔哩登录已失效，请重新扫码")

// LoginError 只暴露状态码，不回显可能包含凭据的上游响应或请求 URL。
type LoginError struct{ Code int }

func (e *LoginError) Error() string { return fmt.Sprintf("哔哩哔哩认证接口返回 %d", e.Code) }

type QRCode struct {
	URL string `json:"url"`
	Key string `json:"qrcode_key"`
}

type Credentials struct {
	Cookie       string
	RefreshToken string
}

type Profile struct {
	MID     int64  `json:"mid"`
	Name    string `json:"uname"`
	Avatar  string `json:"face"`
	IsLogin bool   `json:"isLogin"`
}

// authRequest 仅请求固定的 B 站地址，并禁止重定向转发登录凭据。
func (c *Client) authRequest(ctx context.Context, endpoint, cookie string, form url.Values) ([]byte, []*http.Cookie, error) {
	method := http.MethodGet
	var body io.Reader
	if form != nil {
		method = http.MethodPost
		body = strings.NewReader(form.Encode())
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return nil, nil, errors.New("创建认证请求失败")
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Referer", referer+"/")
	if cookie != "" {
		req.Header.Set("Cookie", cookie)
	}
	if form != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	client := *c.hc
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	resp, err := client.Do(req)
	if err != nil {
		return nil, nil, errors.New("无法连接哔哩哔哩认证接口，请稍后重试")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, nil, fmt.Errorf("哔哩哔哩认证接口 HTTP %d", resp.StatusCode)
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, (1<<20)+1))
	if err != nil || len(b) > 1<<20 {
		return nil, nil, errors.New("读取认证响应失败")
	}
	return b, resp.Cookies(), nil
}

func (c *Client) authJSON(ctx context.Context, endpoint, cookie string, form url.Values, out any) ([]*http.Cookie, error) {
	b, cookies, err := c.authRequest(ctx, endpoint, cookie, form)
	if err != nil {
		return nil, err
	}
	var env struct {
		Code *int            `json:"code"`
		Data json.RawMessage `json:"data"`
	}
	if json.Unmarshal(b, &env) != nil {
		return nil, errors.New("无效的认证响应")
	}
	if env.Code == nil {
		return nil, errors.New("认证响应缺少状态码")
	}
	if *env.Code == -101 {
		return nil, ErrLoginExpired
	}
	if *env.Code != 0 {
		return nil, &LoginError{Code: *env.Code}
	}
	if out != nil && json.Unmarshal(env.Data, out) != nil {
		return nil, errors.New("缺少认证响应数据")
	}
	return cookies, nil
}

func (c *Client) GenerateQR(ctx context.Context) (QRCode, error) {
	var qr QRCode
	_, err := c.authJSON(ctx, passportBase+"/x/passport-login/web/qrcode/generate", "", nil, &qr)
	if err != nil {
		return qr, err
	}
	u, err := url.Parse(qr.URL)
	// 2026 年网页扫码地址已迁到 account 域，兼容旧 passport 地址但不接受任意域名。
	if err != nil || u.Scheme != "https" || u.User != nil || (u.Host != "passport.bilibili.com" && u.Host != "account.bilibili.com") || qr.Key == "" {
		return QRCode{}, errors.New("无效的登录二维码")
	}
	return qr, nil
}

// PollQR 从 Set-Cookie 读取凭据，绝不访问响应中的跨站 SSO URL。
func (c *Client) PollQR(ctx context.Context, key string) (string, Credentials, error) {
	var data struct {
		Code         int    `json:"code"`
		RefreshToken string `json:"refresh_token"`
	}
	cookies, err := c.authJSON(ctx, passportBase+"/x/passport-login/web/qrcode/poll?qrcode_key="+url.QueryEscape(key), "", nil, &data)
	if err != nil {
		return "", Credentials{}, err
	}
	switch data.Code {
	case 86101:
		return "waiting", Credentials{}, nil
	case 86090:
		return "scanned", Credentials{}, nil
	case 86038:
		return "expired", Credentials{}, nil
	case 0:
		cookie := mergeCookies("", cookies)
		if cookieValue(cookie, "SESSDATA") == "" || cookieValue(cookie, "bili_jct") == "" || cookieValue(cookie, "DedeUserID") == "" || data.RefreshToken == "" {
			return "", Credentials{}, errors.New("登录响应缺少凭据，请重新扫码")
		}
		return "success", Credentials{Cookie: cookie, RefreshToken: data.RefreshToken}, nil
	default:
		return "", Credentials{}, &LoginError{Code: data.Code}
	}
}

func (c *Client) Profile(ctx context.Context, cookie string) (Profile, error) {
	var p Profile
	_, err := c.authJSON(ctx, apiBase+"/x/web-interface/nav", cookie, nil, &p)
	if err == nil && (!p.IsLogin || p.MID <= 0) {
		err = ErrLoginExpired
	}
	return p, err
}

func cookieValue(raw, name string) string {
	r := http.Request{Header: http.Header{"Cookie": []string{raw}}}
	c, err := r.Cookie(name)
	if err != nil {
		return ""
	}
	return c.Value
}

func mergeCookies(raw string, incoming []*http.Cookie) string {
	r := http.Request{Header: http.Header{"Cookie": []string{raw}}}
	values := map[string]string{}
	for _, c := range r.Cookies() {
		values[c.Name] = c.Value
	}
	for _, c := range incoming {
		if c.Domain != "" && strings.TrimPrefix(c.Domain, ".") != "bilibili.com" && c.Domain != "passport.bilibili.com" {
			continue
		}
		if c.MaxAge < 0 {
			delete(values, c.Name)
		} else {
			values[c.Name] = c.Value
		}
	}
	names := make([]string, 0, len(values))
	for name := range values {
		names = append(names, name)
	}
	sort.Strings(names)
	parts := make([]string, 0, len(names))
	for _, name := range names {
		parts = append(parts, name+"="+values[name])
	}
	return strings.Join(parts, "; ")
}

// RefreshCookies 使用网页刷新协议；返回后须先持久化新凭据，再确认撤销旧凭据。
func (c *Client) RefreshCookies(ctx context.Context, old Credentials) (Credentials, bool, error) {
	var info struct {
		Refresh   bool  `json:"refresh"`
		Timestamp int64 `json:"timestamp"`
	}
	_, err := c.authJSON(ctx, passportBase+"/x/passport-login/web/cookie/info?csrf="+url.QueryEscape(cookieValue(old.Cookie, "bili_jct")), old.Cookie, nil, &info)
	if err != nil || !info.Refresh {
		return old, false, err
	}
	if old.RefreshToken == "" {
		return old, false, errors.New("旧账号缺少刷新凭据，请重新扫码")
	}
	path, err := correspondPath(info.Timestamp)
	if err != nil {
		return old, false, err
	}
	body, _, err := c.authRequest(ctx, referer+"/correspond/1/"+path, old.Cookie, nil)
	if err != nil {
		return old, false, err
	}
	csrf := refreshCSRF(body)
	if csrf == "" {
		return old, false, errors.New("获取 Cookie 刷新校验码失败")
	}
	var data struct {
		Status       int    `json:"status"`
		RefreshToken string `json:"refresh_token"`
	}
	cookies, err := c.authJSON(ctx, passportBase+"/x/passport-login/web/cookie/refresh", old.Cookie, url.Values{
		"csrf": {cookieValue(old.Cookie, "bili_jct")}, "refresh_csrf": {csrf}, "source": {"main_web"}, "refresh_token": {old.RefreshToken},
	}, &data)
	if err != nil {
		return old, false, err
	}
	// 必须收到新的会话 Cookie，不能把旧 Cookie 与新刷新令牌错误配对。
	newCookie := mergeCookies("", cookies)
	if data.Status != 0 || data.RefreshToken == "" || cookieValue(newCookie, "SESSDATA") == "" || cookieValue(newCookie, "bili_jct") == "" || cookieValue(newCookie, "DedeUserID") != cookieValue(old.Cookie, "DedeUserID") {
		return old, false, errors.New("Cookie 刷新响应不完整或账号不匹配")
	}
	return Credentials{Cookie: mergeCookies(old.Cookie, cookies), RefreshToken: data.RefreshToken}, true, nil
}

func (c *Client) ConfirmRefresh(ctx context.Context, cookie, oldToken string) error {
	_, err := c.authJSON(ctx, passportBase+"/x/passport-login/web/confirm/refresh", cookie, url.Values{
		"csrf": {cookieValue(cookie, "bili_jct")}, "refresh_token": {oldToken},
	}, nil)
	return err
}

func correspondPath(timestamp int64) (string, error) {
	if timestamp <= 0 {
		return "", errors.New("刷新时间戳无效")
	}
	// 此公钥属于 B 站网页刷新协议，不是本项目的私钥或用户凭据。
	n, _ := base64.RawURLEncoding.DecodeString("y4HdjgJHBlbaBN04VERG4qNBIFHP6a3GozCl75AihQloSWCXC5HDNgyinEnhaQ_4-gaMud_GF50elYXLlCToR9se9Z8z433U3KjM-3Yx7ptKkmQNAMggQwAVKgq3zYAoidNEWuxpkY_mAitTSRLnsJW-NCTa0bqBFF6Wm1MxgfE")
	b, err := rsa.EncryptOAEP(sha256.New(), rand.Reader, &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: 65537}, []byte("refresh_"+strconv.FormatInt(timestamp, 10)), nil)
	return hex.EncodeToString(b), err
}

func refreshCSRF(body []byte) string {
	z := html.NewTokenizer(strings.NewReader(string(body)))
	for {
		switch z.Next() {
		case html.ErrorToken:
			return ""
		case html.StartTagToken:
			t := z.Token()
			for _, a := range t.Attr {
				if t.Data == "div" && a.Key == "id" && a.Val == "1-name" && z.Next() == html.TextToken {
					return strings.TrimSpace(string(z.Text()))
				}
			}
		}
	}
}
