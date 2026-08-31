package safefetch

import (
	"fmt"
	"net"
	"net/http"
	"net/url"
	"time"
)

func ValidateURL(raw string) error {
	u, e := url.Parse(raw)
	if e != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Hostname() == "" || u.User != nil {
		return fmt.Errorf("仅允许 HTTP(S) 地址")
	}
	if p := u.Port(); p != "" && p != "80" && p != "443" {
		return fmt.Errorf("不允许此端口")
	}
	return nil
}

// 使用系统解析与拨号，允许代理 Fake-IP 和内网地址；保留超时及重定向限制。
func Client() *http.Client {
	transport := &http.Transport{
		Proxy:                 nil,
		ResponseHeaderTimeout: 10 * time.Second,
		DialContext:           (&net.Dialer{Timeout: 10 * time.Second}).DialContext,
	}
	return &http.Client{Transport: transport, Timeout: 30 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return fmt.Errorf("重定向过多")
		}
		return ValidateURL(req.URL.String())
	}}
}
