package session

import (
	"github.com/akagiyui/oh-my-music-bank/internal/config"
	"strings"
	"testing"
	"time"
)

func TestTokenPurposeAndExpiry(t *testing.T) {
	cfg := config.Auth{JWTSecret: strings.Repeat("x", 32)}
	for _, kind := range []string{"access", "refresh", "media"} {
		raw, e := Sign(cfg, Claims{UserID: "user", Kind: kind, SessionID: "session"}, time.Minute)
		if e != nil {
			t.Fatal(e)
		}
		for _, want := range []string{"access", "refresh", "media"} {
			_, err := Parse(cfg, raw, want)
			if (err == nil) != (kind == want) {
				t.Fatalf("%s accepted as %s: %v", kind, want, err)
			}
		}
	}
	if _, e := Sign(config.Auth{}, Claims{UserID: "u"}, time.Minute); e == nil {
		t.Fatal("empty key accepted")
	}
	if _, e := Sign(cfg, Claims{UserID: "u"}, -time.Minute); e == nil {
		t.Fatal("negative ttl accepted")
	}
}
