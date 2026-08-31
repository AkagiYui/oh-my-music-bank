package bilibili

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

type authTransport func(*http.Request) (*http.Response, error)

func (f authTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func authResponse(body string, cookies ...string) *http.Response {
	h := http.Header{}
	for _, cookie := range cookies {
		h.Add("Set-Cookie", cookie)
	}
	return &http.Response{StatusCode: 200, Header: h, Body: io.NopCloser(strings.NewReader(body))}
}

func TestQRLoginProtocol(t *testing.T) {
	for _, tc := range []struct {
		code   int
		status string
	}{{86101, "waiting"}, {86090, "scanned"}, {86038, "expired"}, {0, "success"}} {
		t.Run(tc.status, func(t *testing.T) {
			client := &Client{hc: &http.Client{Transport: authTransport(func(r *http.Request) (*http.Response, error) {
				if r.URL.Host != "passport.bilibili.com" || r.URL.Query().Get("qrcode_key") != "qr-private" || r.Header.Get("Cookie") != "" {
					t.Fatal("invalid QR request")
				}
				return authResponse(fmt.Sprintf(`{"code":0,"data":{"code":%d,"refresh_token":"refresh-private","url":"https://untrusted.invalid/sso"}}`, tc.code), "SESSDATA=session-private; Domain=.bilibili.com", "bili_jct=csrf; Domain=.bilibili.com", "DedeUserID=123; Domain=.bilibili.com"), nil
			})}}
			status, creds, err := client.PollQR(context.Background(), "qr-private")
			if err != nil || status != tc.status {
				t.Fatalf("status %s: %v", status, err)
			}
			if (creds.RefreshToken != "") != (status == "success") {
				t.Fatal("credentials returned before confirmation")
			}
		})
	}
}

func TestGenerateQRHosts(t *testing.T) {
	for _, endpoint := range []string{"https://account.bilibili.com/h5/account-h5/auth/scan-web", "https://passport.bilibili.com/scan", "https://evil.invalid/scan", "http://account.bilibili.com/scan", "https://evil@account.bilibili.com/scan"} {
		client := &Client{hc: &http.Client{Transport: authTransport(func(*http.Request) (*http.Response, error) {
			return authResponse(fmt.Sprintf(`{"code":0,"data":{"url":%q,"qrcode_key":"test-key"}}`, endpoint)), nil
		})}}
		_, err := client.GenerateQR(context.Background())
		wantOK := endpoint == "https://account.bilibili.com/h5/account-h5/auth/scan-web" || endpoint == "https://passport.bilibili.com/scan"
		if (err == nil) != wantOK {
			t.Fatalf("incorrect domain validation: %s", endpoint)
		}
	}
}

func TestRefreshCookieProtocol(t *testing.T) {
	calls := []string{}
	client := &Client{hc: &http.Client{Transport: authTransport(func(r *http.Request) (*http.Response, error) {
		calls = append(calls, r.URL.Path)
		if r.Method == "POST" {
			if err := r.ParseForm(); err != nil {
				t.Fatal(err)
			}
		}
		switch {
		case strings.HasSuffix(r.URL.Path, "/cookie/info"):
			if r.URL.Query().Get("csrf") != "old-csrf" {
				t.Fatal("missing old csrf")
			}
			return authResponse(`{"code":0,"data":{"refresh":true,"timestamp":1750000000000}}`), nil
		case strings.HasPrefix(r.URL.Path, "/correspond/1/"):
			if len(strings.TrimPrefix(r.URL.Path, "/correspond/1/")) != 256 {
				t.Fatal("invalid RSA ciphertext length")
			}
			return authResponse(`<html><div class="a" id='1-name'>refresh-csrf</div></html>`), nil
		case strings.HasSuffix(r.URL.Path, "/cookie/refresh"):
			if r.Form.Get("csrf") != "old-csrf" || r.Form.Get("refresh_csrf") != "refresh-csrf" || r.Form.Get("refresh_token") != "old-token" || r.Form.Get("source") != "main_web" {
				t.Fatal("incorrect refresh form")
			}
			return authResponse(`{"code":0,"data":{"status":0,"refresh_token":"new-token"}}`, "SESSDATA=new-session; Domain=.bilibili.com", "bili_jct=new-csrf; Domain=.bilibili.com", "DedeUserID=123; Domain=.bilibili.com"), nil
		case strings.HasSuffix(r.URL.Path, "/confirm/refresh"):
			if r.Form.Get("csrf") != "new-csrf" || r.Form.Get("refresh_token") != "old-token" || !strings.Contains(r.Header.Get("Cookie"), "SESSDATA=new-session") {
				t.Fatal("confirmation must use new cookies and old token")
			}
			return authResponse(`{"code":0}`), nil
		default:
			t.Fatalf("unexpected endpoint %s", r.URL.Path)
			return nil, nil
		}
	})}}
	creds, changed, err := client.RefreshCookies(context.Background(), Credentials{Cookie: "SESSDATA=old-session; bili_jct=old-csrf; DedeUserID=123; buvid3=keep", RefreshToken: "old-token"})
	if err != nil || !changed || creds.RefreshToken != "new-token" || !strings.Contains(creds.Cookie, "buvid3=keep") {
		t.Fatalf("refresh failed: %v", err)
	}
	if len(calls) != 3 {
		t.Fatal("old credentials confirmed before caller could persist")
	}
	if err := client.ConfirmRefresh(context.Background(), creds.Cookie, "old-token"); err != nil {
		t.Fatal(err)
	}
}

func TestAuthFailuresKeepSecretsAndRejectMalformedResponses(t *testing.T) {
	for _, body := range []string{`{}`, `{"code":-101}`, `{"code":-400,"message":"secret-session"}`, `{"code":0,"data":{"code":0}}`, `not json`} {
		client := &Client{hc: &http.Client{Transport: authTransport(func(*http.Request) (*http.Response, error) { return authResponse(body), nil })}}
		_, _, err := client.PollQR(context.Background(), "secret-key")
		if err == nil || strings.Contains(err.Error(), "secret") {
			t.Fatal("accepted malformed response or leaked secret")
		}
		if strings.Contains(body, "-101") && !errors.Is(err, ErrLoginExpired) {
			t.Fatal("expiry not classified")
		}
	}
	client := &Client{hc: &http.Client{Transport: authTransport(func(*http.Request) (*http.Response, error) { return nil, errors.New("secret transport URL") })}}
	_, _, err := client.PollQR(context.Background(), "secret-key")
	if err == nil || strings.Contains(err.Error(), "secret") {
		t.Fatal("transport error leaked")
	}
}

func TestNoRefreshAndRefreshCookieMismatch(t *testing.T) {
	client := &Client{hc: &http.Client{Transport: authTransport(func(*http.Request) (*http.Response, error) {
		return authResponse(`{"code":0,"data":{"refresh":false,"timestamp":1}}`), nil
	})}}
	old := Credentials{Cookie: "SESSDATA=keep", RefreshToken: "keep"}
	got, changed, err := client.RefreshCookies(context.Background(), old)
	if err != nil || changed || got != old {
		t.Fatal("unnecessary rotation")
	}
	if refreshCSRF([]byte(`<div id="other">bad</div>`)) != "" {
		t.Fatal("wrong csrf element")
	}
	if _, err := correspondPath(0); err == nil {
		t.Fatal("invalid timestamp accepted")
	}
	if mergeCookies("SESSDATA=keep; sid=old", []*http.Cookie{{Name: "SESSDATA", Value: "evil", Domain: "evil.test"}, {Name: "sid", MaxAge: -1}}) != "SESSDATA=keep" {
		t.Fatal("cookie domain/deletion ignored")
	}
}

func TestAuthRedirectIsNotFollowed(t *testing.T) {
	calls := 0
	client := &Client{hc: &http.Client{Transport: authTransport(func(*http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: 302, Header: http.Header{"Location": []string{"https://other.bilibili.com/steal"}}, Body: io.NopCloser(strings.NewReader(""))}, nil
	})}}
	_, err := client.Profile(context.Background(), "SESSDATA=private")
	if err == nil || calls != 1 {
		t.Fatal("credential request followed redirect")
	}
}

// 仅显式开启时请求真实二维码；不登录、不读取本地凭据，也不输出二维码密钥。
func TestLiveBilibiliQRSmoke(t *testing.T) {
	if os.Getenv("OMMB_BILI_LIVE") != "1" {
		t.Skip("set OMMB_BILI_LIVE=1 for the unauthenticated QR smoke test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	c := New()
	qr, err := c.GenerateQR(ctx)
	if err != nil {
		t.Fatal(err)
	}
	status, credentials, err := c.PollQR(ctx, qr.Key)
	if err != nil {
		t.Fatal(err)
	}
	if status != "waiting" || credentials.Cookie != "" {
		t.Fatal("unexpected unauthenticated QR state")
	}
}
