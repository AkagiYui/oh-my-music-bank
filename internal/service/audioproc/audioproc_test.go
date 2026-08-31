package audioproc

import (
	"context"
	"math"
	"testing"
)

func TestSegmentValidation(t *testing.T) {
	for _, v := range [][3]float64{{-1, 2, 10}, {8, 2, 10}, {1, 11, 10}, {10, 0, 10}, {math.NaN(), 2, 10}, {1, math.Inf(1), 10}} {
		if ValidateSegment(v[0], v[1], v[2]) == nil {
			t.Errorf("accepted %v", v)
		}
	}
	if e := ValidateSegment(1, 3, 10); e != nil {
		t.Fatal(e)
	}
}
func TestCancelledCommand(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, _, e := Command(ctx, "ffmpeg", "-version"); e == nil {
		t.Fatal("cancelled command succeeded")
	}
}
