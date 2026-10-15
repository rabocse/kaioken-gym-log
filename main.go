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
	"time"
)

//go:embed index.html manifest.webmanifest sw.js css js icons img
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
  gymlog [serve] [-addr 127.0.0.1:8080]   serve the app locally (default command)
  gymlog icons [-out icons]     regenerate the app icons and background
`)
}

func serveCmd(args []string) {
	fset := flag.NewFlagSet("serve", flag.ExitOnError)
	// Loopback by default: a dev server on a laptop in a café should not
	// expose the app to the whole LAN. Pass -addr :8080 to bind all
	// interfaces deliberately (e.g. to test from a phone on your own
	// network).
	addr := fset.String("addr", "127.0.0.1:8080", "listen address")
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

	// Sane timeouts: a dev server should not hold sockets open forever
	// against slow or hostile clients.
	srv := &http.Server{
		Addr:              *addr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	url := *addr
	if strings.HasPrefix(url, ":") {
		url = "http://localhost" + url
	} else {
		url = "http://" + url
	}
	log.Printf("Kaioken dev server listening on %s", url)
	log.Fatal(srv.ListenAndServe())
}
