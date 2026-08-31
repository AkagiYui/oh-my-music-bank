package site

import (
	"strings"
	"testing"
)

func TestNormalizeSettings(t *testing.T) {
	for _, tc := range []struct {
		name string
		edit func(*Settings)
	}{
		{"empty system title", func(s *Settings) { s.SystemTitle = " \n " }},
		{"long unicode title", func(s *Settings) { s.SystemTitle = strings.Repeat("音", 81) }},
		{"title newline", func(s *Settings) { s.HomeTitle = "a\nb" }},
		{"control character", func(s *Settings) { s.HomeDescription = "hello\x00world" }},
		{"orphan footer link", func(s *Settings) { s.FooterText = ""; s.FooterLinkURL = "https://example.com" }},
		{"negative retention", func(s *Settings) { s.LogRetentionDays = -1 }},
		{"large retention", func(s *Settings) { s.LogRetentionDays = 3651 }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := FromValues(nil)
			tc.edit(&s)
			if s.Normalize() == nil {
				t.Fatal("invalid settings accepted")
			}
		})
	}
	s := FromValues(nil)
	s.SystemTitle = " 我的音源 "
	s.HomeDescription = " 第一行\n第二行 "
	s.SiteDescription = ""
	s.FooterText = ""
	s.APIOrigin = " https://API.Example.com:8443/ "
	if err := s.Normalize(); err != nil {
		t.Fatal(err)
	}
	if s.SystemTitle != "我的音源" || s.APIOrigin != "https://api.example.com:8443" || s.HomeDescription != "第一行\n第二行" {
		t.Fatalf("not normalized: %+v", s)
	}
	if got := FromValues(s.Values()); got != s {
		t.Fatalf("round trip lost explicit empty values: %+v", got)
	}
}

func TestURLPolicy(t *testing.T) {
	for _, raw := range []string{"", "https://api.example.com", "https://api.example.com:8443/", "http://localhost:9111", "http://127.0.0.1:9111", "http://[::1]:9111"} {
		t.Run("valid "+raw, func(t *testing.T) {
			if _, e := normalizeURL(raw, true); e != nil {
				t.Fatal(e)
			}
		})
	}
	for _, raw := range []string{
		"javascript:alert(1)", "data:image/svg+xml,x", "//api.example.com", "https://user:pass@example.com",
		"https://example.com/api", "https://example.com/?x=1", "https://example.com/?", "https://example.com/#",
		"https://example.com/%2f", "https://example.com:65536", "https://example.com:", "https://example.com:0",
		"http://api.example.com", "http://192.168.1.2", "https://example.com\\@evil.test", "https://bad host",
		"https://x\n.example.com", "https://$(whoami).example.com", "https://bad_host", "https://-host.com",
		"https://127.0.0.999", "https://127.1", "https://example.123", "https://0x7f000001",
	} {
		t.Run("invalid "+raw, func(t *testing.T) {
			if value, e := normalizeURL(raw, true); e == nil {
				t.Fatalf("accepted %q", value)
			}
		})
	}
	for _, raw := range []string{"/brand/logo.svg", "https://cdn.example.com/logo.png?v=2", "/about"} {
		if _, e := normalizeURL(raw, false); e != nil {
			t.Fatal(e)
		}
	}
	for _, raw := range []string{"//evil.test/a", "/\\evil.test", "javascript:alert(1)", "data:image/png;base64,x", "relative.png"} {
		if _, e := normalizeURL(raw, false); e == nil {
			t.Fatalf("accepted asset %q", raw)
		}
	}
}
