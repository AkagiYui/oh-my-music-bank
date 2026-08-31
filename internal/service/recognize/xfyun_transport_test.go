package recognize

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestXfyunCompatibilityTLS(t *testing.T) {
	audio := []byte{0, 1, 255, 128, 42}
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil || !bytes.Equal(body, audio) || r.Header.Get("X-CheckSum") != "test-signature" {
			t.Errorf("重试未保留音频或鉴权头: body=%v, err=%v", body, err)
		}
		w.Write([]byte(`{"code":"0","data":[]}`))
	}))
	// 真实 TLS 服务只提供 RSA + AES-GCM，验证兼容路径没有依赖全局 GODEBUG。
	server.TLS = &tls.Config{
		MinVersion:   tls.VersionTLS12,
		MaxVersion:   tls.VersionTLS12,
		CipherSuites: []uint16{tls.TLS_RSA_WITH_AES_128_GCM_SHA256},
	}
	server.StartTLS()
	defer server.Close()
	roots := x509.NewCertPool()
	roots.AddCert(server.Certificate())

	for _, tc := range []struct {
		name       string
		roots      *x509.CertPool
		serverName string
		wantError  bool
	}{
		{"trusted", roots, "example.com", false},
		{"untrusted", x509.NewCertPool(), "example.com", true},
		{"wrong_hostname", roots, "wrong.example", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			client := newXfyunHTTPClient()
			transport := client.Transport.(*xfyunTransport)
			compat := transport.compat.(*http.Transport)
			defer compat.CloseIdleConnections()
			compat.Proxy = nil
			compat.DialContext = func(ctx context.Context, network, _ string) (net.Conn, error) {
				return (&net.Dialer{}).DialContext(ctx, network, server.Listener.Addr().String())
			}
			compat.TLSClientConfig.RootCAs = tc.roots
			compat.TLSClientConfig.ServerName = tc.serverName
			primaryCalls := 0
			transport.primary = roundTripFunc(func(r *http.Request) (*http.Response, error) {
				primaryCalls++
				// 消耗并关闭原始请求体，确保重试确实通过 GetBody 重建音频。
				io.Copy(io.Discard, r.Body)
				r.Body.Close()
				return nil, errors.New("tls: certificate used with invalid signature algorithm")
			})
			req, err := http.NewRequestWithContext(t.Context(), http.MethodPost, xfyunEndpoint, bytes.NewReader(audio))
			if err != nil {
				t.Fatal(err)
			}
			req.Header.Set("X-CheckSum", "test-signature")
			resp, err := client.Do(req)
			if primaryCalls != 1 {
				t.Fatalf("primary calls = %d", primaryCalls)
			}
			if tc.wantError {
				var verifyErr *tls.CertificateVerificationError
				if !errors.As(err, &verifyErr) {
					t.Fatalf("want certificate verification failure, got %v", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			defer resp.Body.Close()
			if resp.TLS.Version != tls.VersionTLS12 || resp.TLS.CipherSuite != tls.TLS_RSA_WITH_AES_128_GCM_SHA256 || len(resp.TLS.VerifiedChains) == 0 {
				t.Fatal("兼容连接未使用已验证的 TLS 1.2 RSA + AES-GCM")
			}
		})
	}
}

func TestXfyunDoesNotRetryOtherFailures(t *testing.T) {
	for _, tc := range []struct {
		name   string
		err    error
		status int
	}{
		{"success", nil, http.StatusOK},
		{"business_error", nil, http.StatusBadRequest},
		{"gateway_error", nil, http.StatusBadGateway},
		{"certificate", x509.UnknownAuthorityError{}, 0},
		{"timeout", context.DeadlineExceeded, 0},
		{"connection", io.ErrUnexpectedEOF, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			transport := &xfyunTransport{
				primary: roundTripFunc(func(r *http.Request) (*http.Response, error) {
					r.Body.Close()
					if tc.err != nil {
						return nil, tc.err
					}
					return &http.Response{StatusCode: tc.status, Body: http.NoBody}, nil
				}),
				compat: roundTripFunc(func(*http.Request) (*http.Response, error) {
					t.Fatal("不应触发兼容重试")
					return nil, nil
				}),
			}
			req, _ := http.NewRequestWithContext(t.Context(), http.MethodPost, xfyunEndpoint, bytes.NewReader([]byte{0}))
			resp, err := transport.RoundTrip(req)
			if !errors.Is(err, tc.err) {
				t.Fatal(err)
			}
			if resp != nil {
				resp.Body.Close()
			}
		})
	}
}

func TestXfyunRetryStops(t *testing.T) {
	for _, cancel := range []bool{false, true} {
		client := newXfyunHTTPClient()
		transport := client.Transport.(*xfyunTransport)
		ctx, stop := context.WithCancel(t.Context())
		compatCalls := 0
		transport.primary = roundTripFunc(func(r *http.Request) (*http.Response, error) {
			r.Body.Close()
			if cancel {
				stop()
			}
			return nil, errors.New("tls: certificate used with invalid signature algorithm")
		})
		transport.compat = roundTripFunc(func(r *http.Request) (*http.Response, error) {
			compatCalls++
			r.Body.Close()
			if r.Context() != ctx {
				t.Error("重试必须保留原请求取消与截止时间")
			}
			return nil, errors.New("tls: certificate used with invalid signature algorithm")
		})
		req, _ := http.NewRequestWithContext(ctx, http.MethodPost, xfyunEndpoint, bytes.NewReader([]byte{0}))
		_, err := transport.RoundTrip(req)
		stop()
		if err == nil || (cancel && compatCalls != 0) || (!cancel && compatCalls != 1) {
			t.Fatalf("cancel=%v, compat calls=%d, err=%v", cancel, compatCalls, err)
		}
	}
}

func TestXfyunRejectsOtherEndpointsAndRedirects(t *testing.T) {
	client := newXfyunHTTPClient()
	transport := client.Transport.(*xfyunTransport)
	calls := 0
	transport.primary = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		r.Body.Close()
		return &http.Response{
			StatusCode: http.StatusTemporaryRedirect,
			Header:     http.Header{"Location": []string{"https://other.example/"}},
			Body:       http.NoBody,
		}, nil
	})
	for _, endpoint := range []string{
		"http://webqbh.xfyun.cn/v1/service/v1/qbh",
		"https://webqbh.xfyun.cn:8443/v1/service/v1/qbh",
		"https://other.example/v1/service/v1/qbh",
	} {
		req, _ := http.NewRequestWithContext(t.Context(), http.MethodPost, endpoint, bytes.NewReader([]byte{0}))
		if _, err := client.Do(req); err == nil {
			t.Fatalf("unexpectedly allowed %s", endpoint)
		}
	}
	if calls != 0 {
		t.Fatal("其他端点不应发出请求")
	}
	req, _ := http.NewRequestWithContext(t.Context(), http.MethodPost, xfyunEndpoint, bytes.NewReader([]byte{0}))
	resp, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if calls != 1 || resp.StatusCode != http.StatusTemporaryRedirect {
		t.Fatal("不应跟随重定向")
	}
}

func TestXfyunLiveTLS(t *testing.T) {
	if os.Getenv("OMMB_TEST_XFYUN_LIVE") != "1" {
		t.Skip("设置 OMMB_TEST_XFYUN_LIVE=1 验证真实讯飞 HTTPS 端点；不使用真实凭据")
	}
	client := newXfyunHTTPClient()
	transport := client.Transport.(*xfyunTransport)
	defer transport.primary.(*http.Transport).CloseIdleConnections()
	defer transport.compat.(*http.Transport).CloseIdleConnections()
	req, _ := http.NewRequestWithContext(t.Context(), http.MethodPost, xfyunEndpoint, strings.NewReader(""))
	resp, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.TLS == nil || len(resp.TLS.VerifiedChains) == 0 {
		t.Fatal("真实端点必须通过 TLS 证书校验")
	}
	var result struct {
		Code string `json:"code"`
		Desc string `json:"desc"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil || result.Code == "" || result.Code == "0" {
		t.Fatalf("无凭据请求应收到讯飞鉴权错误: %+v, err=%v", result, err)
	}
	t.Logf("TLS=%s, cipher=%s, HTTP=%d, code=%s, desc=%s", tls.VersionName(resp.TLS.Version), tls.CipherSuiteName(resp.TLS.CipherSuite), resp.StatusCode, result.Code, result.Desc)
	// 使用虚构凭据走生产识别入口，确认签名、请求体和错误解析也能到达业务层。
	_, err = Xfyun(t.Context(), XfyunCreds{AppID: "00000000", APIKey: "not-a-real-api-key"}, make([]byte, 32000))
	if err == nil || !strings.HasPrefix(err.Error(), "讯飞识别失败 [") {
		t.Fatalf("生产入口应返回讯飞业务错误，实际: %v", err)
	}
	t.Log(err)
}
