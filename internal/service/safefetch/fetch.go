package safefetch

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"time"
)

func PublicIP(ip net.IP) bool {
	if ip == nil || !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsUnspecified() {
		return false
	}
	for _, s := range []string{"100.64.0.0/10", "192.0.0.0/24", "198.18.0.0/15", "192.0.2.0/24", "198.51.100.0/24", "203.0.113.0/24", "240.0.0.0/4"} {
		_, n, _ := net.ParseCIDR(s)
		if n.Contains(ip) {
			return false
		}
	}
	return true
}
func ValidateURL(raw string) error {
	u, e := url.Parse(raw)
	if e != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Hostname() == "" || u.User != nil {
		return fmt.Errorf("仅允许公网 HTTP(S) 地址")
	}
	if p := u.Port(); p != "" && p != "80" && p != "443" {
		return fmt.Errorf("不允许此端口")
	}
	return nil
}

// 连接时校验并固定解析地址，同时检查重定向，防止 DNS 重绑定和内网请求。
func Client() *http.Client {
	transport := &http.Transport{Proxy: nil, ResponseHeaderTimeout: 10 * time.Second, DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, port, e := net.SplitHostPort(addr)
		if e != nil {
			return nil, e
		}
		ips, e := net.DefaultResolver.LookupIPAddr(ctx, host)
		if e != nil {
			return nil, e
		}
		if len(ips) == 0 {
			return nil, fmt.Errorf("地址解析失败")
		}
		for _, ip := range ips {
			if !PublicIP(ip.IP) {
				return nil, fmt.Errorf("禁止访问非公网地址")
			}
		}
		return (&net.Dialer{Timeout: 10 * time.Second}).DialContext(ctx, network, net.JoinHostPort(ips[0].IP.String(), port))
	}}
	return &http.Client{Transport: transport, Timeout: 30 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return fmt.Errorf("重定向过多")
		}
		return ValidateURL(req.URL.String())
	}}
}
