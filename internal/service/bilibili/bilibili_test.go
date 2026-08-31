package bilibili

import (
	"net/url"
	"strings"
	"testing"
)

func TestMixinKeyTableIsPermutation(t *testing.T) {
	if len(mixinKeyEncTab) != 64 {
		t.Fatalf("table len = %d, want 64", len(mixinKeyEncTab))
	}
	seen := make(map[int]bool, 64)
	for _, v := range mixinKeyEncTab {
		if v < 0 || v >= 64 {
			t.Fatalf("value %d out of range", v)
		}
		if seen[v] {
			t.Fatalf("duplicate value %d", v)
		}
		seen[v] = true
	}
}

func TestMixinKeyLength(t *testing.T) {
	img := "7cd084941338484aae1ad9425b84077c"
	sub := "4932caff0ff746eab6f01bf08b70ac45"
	mk := mixinKey(img, sub)
	if len(mk) != 32 {
		t.Fatalf("mixinKey len = %d, want 32", len(mk))
	}
}

func TestSignWBIAppendsSignature(t *testing.T) {
	vals := url.Values{}
	vals.Set("bvid", "BV1xx411c7mD")
	vals.Set("cid", "12345")
	q := signWBI(vals, "0123456789abcdef0123456789abcdef")
	if !strings.Contains(q, "w_rid=") {
		t.Fatalf("missing w_rid: %s", q)
	}
	if !strings.Contains(q, "wts=") {
		t.Fatalf("missing wts: %s", q)
	}
	// w_rid 应为 32 位十六进制 md5。
	_, after, _ := strings.Cut(q, "w_rid=")
	if got := after; len(got) != 32 {
		t.Fatalf("w_rid len = %d, want 32 (%s)", len(got), got)
	}
}

func TestKeyFromURL(t *testing.T) {
	got := keyFromURL("https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png")
	if got != "7cd084941338484aae1ad9425b84077c" {
		t.Fatalf("keyFromURL = %q", got)
	}
}
