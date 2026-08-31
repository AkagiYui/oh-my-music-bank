package safefetch

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestValidateURL(t *testing.T) {
	for _, raw := range []string{"http://127.0.0.1", "http://10.0.0.1", "http://198.18.0.74", "http://[fdfe:dcba:9876::49]", "https://i0.hdslb.com/cover.jpg"} {
		if err := ValidateURL(raw); err != nil {
			t.Errorf("rejected %s: %v", raw, err)
		}
	}
	for _, raw := range []string{"file:///etc/passwd", "http://user:pass@example.com", "http://example.com:8080"} {
		if ValidateURL(raw) == nil {
			t.Errorf("accepted %s", raw)
		}
	}
}

func TestClientAllowsLoopback(t *testing.T) {
	// 实际连接本地服务，避免只检查 URL 而漏掉拨号阶段的地址拦截。
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "cover")
	}))
	defer server.Close()
	client := Client()
	defer client.CloseIdleConnections()
	resp, err := client.Get(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil || resp.StatusCode != http.StatusOK || string(body) != "cover" {
		t.Fatalf("unexpected response: status=%d body=%q err=%v", resp.StatusCode, body, err)
	}
}
