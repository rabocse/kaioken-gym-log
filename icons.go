package main

import (
	"flag"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"log"
	"os"
	"path/filepath"
)

// rect is a rounded rectangle in normalized (0..1) icon coordinates.
type rect struct {
	x0, y0, x1, y1, r float64
}

func clamp(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// inside reports whether (x, y) falls within the rounded rect.
func inside(x, y float64, rc rect) bool {
	cx := clamp(x, rc.x0+rc.r, rc.x1-rc.r)
	cy := clamp(y, rc.y0+rc.r, rc.y1-rc.r)
	dx, dy := x-cx, y-cy
	return dx*dx+dy*dy <= rc.r*rc.r
}

// dumbbell is a simple flat dumbbell, kept within the 80% maskable safe
// zone (all coordinates between 0.1 and 0.9).
var dumbbell = []rect{
	{0.30, 0.474, 0.70, 0.526, 0.026},  // handle
	{0.225, 0.335, 0.31, 0.665, 0.030}, // left big plate
	{0.69, 0.335, 0.775, 0.665, 0.030}, // right big plate
	{0.155, 0.42, 0.23, 0.58, 0.025},   // left small plate
	{0.77, 0.42, 0.845, 0.58, 0.025},   // right small plate
}

var (
	iconBg = color.RGBA{R: 0x0f, G: 0x13, B: 0x16, A: 0xff} // #0f1316
	iconFg = color.RGBA{R: 0x34, G: 0xd3, B: 0x99, A: 0xff} // #34d399
)

// renderIcon draws the GymLog icon at the given square size, using 4x4
// supersampling per pixel for smooth edges.
func renderIcon(size int) *image.RGBA {
	const ss = 4
	img := image.NewRGBA(image.Rect(0, 0, size, size))
	total := float64(size * ss)
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			var hit int
			for sy := 0; sy < ss; sy++ {
				for sx := 0; sx < ss; sx++ {
					px := (float64(x*ss+sx) + 0.5) / total
					py := (float64(y*ss+sy) + 0.5) / total
					for _, rc := range dumbbell {
						if inside(px, py, rc) {
							hit++
							break
						}
					}
				}
			}
			t := float64(hit) / float64(ss*ss)
			img.SetRGBA(x, y, mix(iconBg, iconFg, t))
		}
	}
	return img
}

func mix(a, b color.RGBA, t float64) color.RGBA {
	return color.RGBA{
		R: blend(a.R, b.R, t),
		G: blend(a.G, b.G, t),
		B: blend(a.B, b.B, t),
		A: 0xff,
	}
}

func blend(a, b uint8, t float64) uint8 {
	return uint8(float64(a) + (float64(b)-float64(a))*t)
}

func iconsCmd(args []string) {
	fset := flag.NewFlagSet("icons", flag.ExitOnError)
	out := fset.String("out", "icons", "output directory")
	_ = fset.Parse(args)

	icons := []struct {
		name string
		size int
	}{
		{"icon-512.png", 512},
		{"icon-192.png", 192},
		{"apple-touch-icon.png", 180},
	}
	if err := os.MkdirAll(*out, 0o755); err != nil {
		log.Fatal(err)
	}
	for _, ic := range icons {
		path := filepath.Join(*out, ic.name)
		f, err := os.Create(path)
		if err != nil {
			log.Fatal(err)
		}
		if err := png.Encode(f, renderIcon(ic.size)); err != nil {
			f.Close()
			log.Fatal(err)
		}
		if err := f.Close(); err != nil {
			log.Fatal(err)
		}
		fmt.Printf("wrote %s (%dx%d)\n", path, ic.size, ic.size)
	}
}
