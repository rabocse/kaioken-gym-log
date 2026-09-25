// Command gymlog is a local helper for the Kaioken app:
//
//	gymlog [serve]  serve the embedded app for local development (default)
//	gymlog icons    regenerate the app icons
//
// The app itself is pure static files (see this repo root) and needs no
// backend: data is stored on the phone in IndexedDB.
package main

import (
	"embed"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
)

//go:embed index.html manifest.webmanifest sw.js css js icons
var webFiles embed.FS

func main() {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "serve":
			serveCmd(os.Args[2:])
		case "icons":
			iconsCmd(os.Args[2:])
		default:
			usage()
		}
		return
	}
	serveCmd(nil)
}

func usage() {
	fmt.Print(`Kaioken - minimalist gym routine tracker (PWA)

Usage:
  gymlog [serve] [-addr :8080]   serve the app locally (default command)
  gymlog icons [-out icons]     regenerate the app icons
`)
}

func serveCmd(args []string) {
	fset := flag.NewFlagSet("serve", flag.ExitOnError)
	addr := fset.String("addr", ":8080", "listen address")
	_ = fset.Parse(args)

	files := http.FileServer(http.FS(webFiles))
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.ToLower(r.URL.Path)
		if strings.HasSuffix(p, ".webmanifest") {
			w.Header().Set("Content-Type", "application/manifest+json")
		}
		if strings.HasSuffix(p, "sw.js") {
			// Always let the browser revalidate the service worker so
			// updates are picked up quickly during development.
			w.Header().Set("Cache-Control", "no-cache")
		}
		files.ServeHTTP(w, r)
	})

	url := *addr
	if strings.HasPrefix(url, ":") {
		url = "http://localhost" + url
	} else {
		url = "http://" + url
	}
	log.Printf("Kaioken dev server listening on %s", url)
	log.Fatal(http.ListenAndServe(*addr, handler))
}
