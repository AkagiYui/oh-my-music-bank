package recognize

import (
	"crypto/tls"
	"fmt"
	"net/http"
	"time"
)

const xfyunEndpoint = "https://webqbh.xfyun.cn/v1/service/v1/qbh"

var xfyunHTTPClient = newXfyunHTTPClient()

func newXfyunHTTPClient() *http.Client {
	primary := http.DefaultTransport.(*http.Transport).Clone()
	compat := primary.Clone()
	// 旧网关的 ECDHE 握手仍使用 SHA-1；仅在该握手失败后使用 RSA + AES-GCM。
	// 保留证书链、域名和有效期校验，不全局启用 SHA-1，也不降级为明文 HTTP。
	// RSA 密钥交换没有前向保密性；默认连接成功时不会使用这个兼容路径。
	compat.TLSClientConfig = &tls.Config{
		MinVersion: tls.VersionTLS12,
		CipherSuites: []uint16{
			tls.TLS_RSA_WITH_AES_128_GCM_SHA256,
			tls.TLS_RSA_WITH_AES_256_GCM_SHA384,
		},
	}
	return &http.Client{
		Transport: &xfyunTransport{primary: primary, compat: compat},
		Timeout:   30 * time.Second,
		// 不跟随重定向，防止音频和自定义鉴权头被转发到其他端点。
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
}

type xfyunTransport struct {
	primary http.RoundTripper
	compat  http.RoundTripper
}

func (t *xfyunTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if req.URL.String() != xfyunEndpoint {
		if req.Body != nil {
			req.Body.Close()
		}
		return nil, fmt.Errorf("讯飞请求地址不受支持")
	}
	resp, err := t.primary.RoundTrip(req)
	// Go 尚未为该握手错误导出类型。精确匹配，避免对证书错误、超时或业务错误重试。
	// 此时 TLS 握手尚未完成，音频未发给服务端；只允许重试一次且共用请求超时。
	if err == nil || err.Error() != "tls: certificate used with invalid signature algorithm" || req.Context().Err() != nil {
		return resp, err
	}
	if req.GetBody == nil {
		return nil, err
	}
	retry := req.Clone(req.Context())
	retry.Body, err = req.GetBody()
	if err != nil {
		return nil, err
	}
	return t.compat.RoundTrip(retry)
}
