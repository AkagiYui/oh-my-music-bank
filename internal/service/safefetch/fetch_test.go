package safefetch

import (
	"context"
	"net"
	"net/http"
	"testing"
	"time"
)

func TestRejectPrivateDestinations(t *testing.T) {
	for _, raw := range []string{"127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.0.1", "169.254.169.254", "::1", "::ffff:127.0.0.1", "100.100.100.200", "fd00::1", "0.0.0.0"} {
		if PublicIP(net.ParseIP(raw)) {
			t.Errorf("accepted %s", raw)
		}
	}
	for _, raw := range []string{"file:///etc/passwd", "http://user:pass@example.com", "http://example.com:8080"} {
		if ValidateURL(raw) == nil {
			t.Errorf("accepted %s", raw)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", "http://127.0.0.1/", nil)
	if _, e := Client().Do(req); e == nil {
		t.Fatal("loopback request accepted")
	}
}
