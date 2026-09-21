package ui

import (
	"encoding/json"
	"image/png"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func pwaMux() *httptest.Server {
	mux := http.NewServeMux()
	RegisterPWAHandlers(mux)
	return httptest.NewServer(mux)
}

func TestPWARoutesServeAssets(t *testing.T) {
	srv := pwaMux()
	defer srv.Close()

	cases := []struct {
		path        string
		contentType string
	}{
		{"/manifest.webmanifest", "application/manifest+json"},
		{"/sw.js", "application/javascript; charset=utf-8"},
		{"/icon.svg", "image/svg+xml"},
		{"/icon-maskable.svg", "image/svg+xml"},
		{"/icon-192.png", "image/png"},
		{"/icon-512.png", "image/png"},
		{"/icon-maskable-512.png", "image/png"},
		{"/apple-touch-icon.png", "image/png"},
	}
	for _, c := range cases {
		res, err := http.Get(srv.URL + c.path)
		if err != nil {
			t.Fatalf("GET %s: %v", c.path, err)
		}
		if res.StatusCode != http.StatusOK {
			t.Fatalf("GET %s: status %d, want 200", c.path, res.StatusCode)
		}
		if got := res.Header.Get("Content-Type"); got != c.contentType {
			t.Fatalf("GET %s: Content-Type %q, want %q", c.path, got, c.contentType)
		}
		res.Body.Close()
	}
}

func TestPWAServiceWorkerScopeHeader(t *testing.T) {
	srv := pwaMux()
	defer srv.Close()

	res, err := http.Get(srv.URL + "/sw.js")
	if err != nil {
		t.Fatalf("GET /sw.js: %v", err)
	}
	defer res.Body.Close()
	if got := res.Header.Get("Service-Worker-Allowed"); got != "/" {
		t.Fatalf("Service-Worker-Allowed = %q, want /", got)
	}
}

func TestPWAPNGIconsDecodeAtExpectedSizes(t *testing.T) {
	srv := pwaMux()
	defer srv.Close()

	cases := []struct {
		path string
		size int
	}{
		{"/icon-192.png", 192},
		{"/icon-512.png", 512},
		{"/icon-maskable-512.png", 512},
		{"/apple-touch-icon.png", 180},
	}
	for _, c := range cases {
		res, err := http.Get(srv.URL + c.path)
		if err != nil {
			t.Fatalf("GET %s: %v", c.path, err)
		}
		img, err := png.Decode(res.Body)
		res.Body.Close()
		if err != nil {
			t.Fatalf("GET %s: invalid PNG: %v", c.path, err)
		}
		if got := img.Bounds().Dx(); got != c.size || img.Bounds().Dy() != c.size {
			t.Fatalf("%s: %dx%d, want %dx%d", c.path, got, img.Bounds().Dy(), c.size, c.size)
		}
	}
}

func TestPWAManifestInstallability(t *testing.T) {
	srv := pwaMux()
	defer srv.Close()

	res, err := http.Get(srv.URL + "/manifest.webmanifest")
	if err != nil {
		t.Fatalf("GET manifest: %v", err)
	}
	defer res.Body.Close()
	var m struct {
		Name      string `json:"name"`
		ShortName string `json:"short_name"`
		ID        string `json:"id"`
		StartURL  string `json:"start_url"`
		Scope     string `json:"scope"`
		Display   string `json:"display"`
		Icons     []struct {
			Src     string `json:"src"`
			Sizes   string `json:"sizes"`
			Type    string `json:"type"`
			Purpose string `json:"purpose"`
		} `json:"icons"`
	}
	if err := json.NewDecoder(res.Body).Decode(&m); err != nil {
		t.Fatalf("manifest JSON: %v", err)
	}
	if m.Name != "Pi Web" {
		t.Fatalf("name = %q, want Pi Web", m.Name)
	}
	if m.ShortName == "" {
		t.Fatal("manifest missing short_name")
	}
	if m.ID != "/" {
		t.Fatalf("id = %q, want /", m.ID)
	}
	if m.StartURL != "/" {
		t.Fatalf("start_url = %q, want /", m.StartURL)
	}
	if m.Scope != "/" {
		t.Fatalf("scope = %q, want /", m.Scope)
	}
	if m.Display != "standalone" {
		t.Fatalf("display = %q, want standalone", m.Display)
	}
	hasIcon := func(sizes, purpose, typ string) bool {
		for _, ic := range m.Icons {
			if ic.Sizes == sizes && ic.Purpose == purpose && ic.Type == typ {
				return true
			}
		}
		return false
	}
	for _, want := range [][3]string{
		{"192x192", "any", "image/png"},
		{"512x512", "any", "image/png"},
		{"512x512", "maskable", "image/png"},
	} {
		if !hasIcon(want[0], want[1], want[2]) {
			t.Fatalf("manifest missing %s %s icon (%s)", want[0], want[1], want[2])
		}
	}
}

// The service worker must stay a no-cache shell: installability + push only.
// Guard against a future regression that caches API/SSE/HTML responses.
func TestPWAServiceWorkerDoesNotCache(t *testing.T) {
	// Match actual API usage, not the explanatory comment that mentions them.
	if strings.Contains(swJS, "caches.open(") || strings.Contains(swJS, ".respondWith(") {
		t.Fatal("sw.js must not intercept/cache fetches (no respondWith / caches.open)")
	}
}

// PWA assets must never carry auth state or secrets: they are registered
// without auth.Wrap and served to unauthenticated install checks.
func TestPWAAssetsContainNoSecrets(t *testing.T) {
	for name, body := range map[string]string{
		"manifest": manifestJSON,
		"sw.js":    swJS,
	} {
		for _, secret := range []string{"token", "cookie", "PI_WEB_TOKEN", "Authorization"} {
			if strings.Contains(strings.ToLower(body), strings.ToLower(secret)) {
				t.Fatalf("%s embeds %q — PWA assets are served unauthenticated", name, secret)
			}
		}
	}
}
