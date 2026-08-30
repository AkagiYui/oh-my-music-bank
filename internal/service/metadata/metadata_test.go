package metadata

import "testing"

func TestStripLRC(t *testing.T) {
	in := "[00:00.00]作词 : A\n[00:12.34]hello world\n[00:20.00]\n[ti:x][ar:y]line"
	got := stripLRC(in)
	want := "作词 : A\nhello world\nline"
	if got != want {
		t.Fatalf("stripLRC =\n%q\nwant\n%q", got, want)
	}
}

func TestStripLRCEmpty(t *testing.T) {
	if got := stripLRC(""); got != "" {
		t.Fatalf("want empty, got %q", got)
	}
}
