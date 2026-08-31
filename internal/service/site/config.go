// Package site 定义公开品牌配置及其校验，不包含任何集成凭据。
package site

import (
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

type Config struct {
	SystemTitle         string `json:"systemTitle"`
	SiteDescription     string `json:"siteDescription"`
	HomeTitle           string `json:"homeTitle"`
	HomeDescription     string `json:"homeDescription"`
	LogoURL             string `json:"logoUrl"`
	FaviconURL          string `json:"faviconUrl"`
	FooterText          string `json:"footerText"`
	FooterLinkURL       string `json:"footerLinkUrl"`
	APIOrigin           string `json:"apiOrigin"`
	RegistrationEnabled bool   `json:"registrationEnabled"`
}

type Settings struct {
	Config
	LogRetentionDays int `json:"logRetentionDays"`
}

// FromValues 仅投影公开字段；缺失时使用默认值，显式空字符串不会被默认文案覆盖。
func FromValues(values map[string]string) Settings {
	get := func(key, fallback string) string {
		if value, ok := values[key]; ok {
			return value
		}
		return fallback
	}
	days, _ := strconv.Atoi(values["logs.retention_days"])
	return Settings{Config: Config{
		SystemTitle:     get("site.system_title", "声迹"),
		SiteDescription: get("site.description", "探索歌曲、歌手与专辑，查找音乐背后的作品信息。从熟悉的旋律出发，走近你喜欢的音乐。"),
		HomeTitle:       get("site.home_title", "每一首喜欢，都值得被找到"),
		HomeDescription: get("site.home_description", "重逢一首念念不忘的歌，认识一个打动你的声音，了解一张值得细听的专辑。关于音乐的好奇，就从这里开始。"),
		LogoURL:         values["site.logo_url"], FaviconURL: values["site.favicon_url"],
		FooterText: get("site.footer_text", "音乐不止于聆听。"), FooterLinkURL: values["site.footer_link_url"],
		APIOrigin: values["site.api_origin"], RegistrationEnabled: get("site.registration_enabled", "true") == "true",
	}, LogRetentionDays: days}
}

func (s Settings) Values() map[string]string {
	return map[string]string{
		"site.system_title": s.SystemTitle, "site.description": s.SiteDescription,
		"site.home_title": s.HomeTitle, "site.home_description": s.HomeDescription,
		"site.logo_url": s.LogoURL, "site.favicon_url": s.FaviconURL,
		"site.footer_text": s.FooterText, "site.footer_link_url": s.FooterLinkURL,
		"site.api_origin": s.APIOrigin, "site.registration_enabled": strconv.FormatBool(s.RegistrationEnabled),
		"logs.retention_days": strconv.Itoa(s.LogRetentionDays),
	}
}

// Normalize 统一清理首尾空白并校验完整配置，调用方必须在持久化前执行。
func (s *Settings) Normalize() error {
	for _, field := range []struct {
		value               *string
		name                string
		max                 int
		required, multiline bool
	}{
		{&s.SystemTitle, "系统标题", 80, true, false},
		{&s.SiteDescription, "站点描述", 300, false, true},
		{&s.HomeTitle, "首页标题", 120, true, false},
		{&s.HomeDescription, "首页描述", 2000, false, true},
		{&s.FooterText, "页脚文字", 300, false, true},
	} {
		*field.value = strings.TrimSpace(*field.value)
		if field.required && *field.value == "" {
			return fmt.Errorf("%s不能为空", field.name)
		}
		if utf8.RuneCountInString(*field.value) > field.max {
			return fmt.Errorf("%s最多 %d 个字符", field.name, field.max)
		}
		for _, r := range *field.value {
			if unicode.IsControl(r) && !(field.multiline && r == '\n') {
				return fmt.Errorf("%s包含不支持的控制字符", field.name)
			}
		}
	}
	for _, field := range []struct {
		value  *string
		name   string
		origin bool
	}{
		{&s.LogoURL, "Logo 地址", false}, {&s.FaviconURL, "站点图标地址", false},
		{&s.FooterLinkURL, "页脚链接", false}, {&s.APIOrigin, "API 独立域名", true},
	} {
		value, err := normalizeURL(*field.value, field.origin)
		if err != nil {
			return fmt.Errorf("%s：%w", field.name, err)
		}
		*field.value = value
	}
	if s.FooterLinkURL != "" && s.FooterText == "" {
		return fmt.Errorf("填写页脚链接时必须填写页脚文字")
	}
	if s.LogRetentionDays < 0 || s.LogRetentionDays > 3650 {
		return fmt.Errorf("保留天数须为0至3650，0表示永久保留")
	}
	return nil
}

func normalizeURL(raw string, origin bool) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", nil
	}
	invalid := fmt.Errorf("仅支持 HTTPS 地址（本机开发可使用 HTTP），不得包含凭据或片段；API 域名不得包含路径、查询参数")
	if len(raw) > 2048 || strings.ContainsAny(raw, "\\\"'<>`") || strings.ContainsFunc(raw, func(r rune) bool { return unicode.IsSpace(r) || unicode.IsControl(r) }) {
		return "", invalid
	}
	u, err := url.Parse(raw)
	if err != nil || u.User != nil || u.Fragment != "" || strings.Contains(raw, "#") || u.Opaque != "" {
		return "", invalid
	}
	// 品牌资源和页脚允许站点根路径，不允许 //host 或反斜杠绕过来源检查。
	if !origin && strings.HasPrefix(raw, "/") && !strings.HasPrefix(raw, "//") && u.Host == "" {
		return raw, nil
	}
	host := strings.ToLower(u.Hostname())
	ip := net.ParseIP(host)
	local := host == "localhost" || (ip != nil && ip.IsLoopback())
	if host == "" || (u.Scheme != "https" && !(u.Scheme == "http" && local)) {
		return "", invalid
	}
	if ip == nil {
		if len(host) > 253 {
			return "", invalid
		}
		// 浏览器会把数字结尾的主机名按 IPv4 解释；拒绝简写和无效数字地址，保持两端解析一致。
		labels := strings.Split(host, ".")
		last := labels[len(labels)-1]
		if strings.Trim(last, "0123456789") == "" || strings.HasPrefix(last, "0x") {
			return "", invalid
		}
		for _, label := range labels {
			if label == "" || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
				return "", invalid
			}
			for _, r := range label {
				if !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '-') {
					return "", invalid
				}
			}
		}
	}
	if port := u.Port(); port != "" {
		n, err := strconv.Atoi(port)
		if err != nil || n < 1 || n > 65535 {
			return "", invalid
		}
	} else if strings.HasSuffix(u.Host, ":") {
		return "", invalid
	}
	u.Host = strings.ToLower(u.Host)
	if origin {
		if (u.Path != "" && u.Path != "/") || u.RawPath != "" || u.RawQuery != "" || u.ForceQuery {
			return "", invalid
		}
		u.Path = ""
	}
	return u.String(), nil
}
