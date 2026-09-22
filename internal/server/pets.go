package server

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"pi-web/internal/agentdir"
)

// petManifest is the Codex custom-pet manifest shape (pet.json). Only the
// fields pi-web needs are decoded; unknown fields pass through untouched.
type petManifest struct {
	ID                  string `json:"id"`
	DisplayName         string `json:"displayName"`
	Description         string `json:"description"`
	SpritesheetPath     string `json:"spritesheetPath"`
	SpriteVersionNumber int    `json:"spriteVersionNumber"`
}

// petSummary is the list payload returned by /api/pets.
type petSummary struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
	Description string `json:"description"`
	Source      string `json:"source"` // "pi-web" | "codex"
}

// petPackageRoot pairs a scan directory with the source label reported to the
// client (so the UI can distinguish a pi-web-local pet from a Codex one).
type petPackageRoot struct {
	dir    string
	source string
}

// petPackageDirs returns the directories scanned for Codex-compatible pet
// packages, in priority order. pi-web's own dir wins so a user can shadow a
// Codex pet with a local copy of the same id.
func (s *Server) petPackageDirs() []petPackageRoot {
	dirs := []petPackageRoot{
		{dir: filepath.Join(agentdir.WebDir(s.agentDir), "pets"), source: "pi-web"},
	}
	home, _ := os.UserHomeDir()
	if home != "" {
		dirs = append(dirs, petPackageRoot{dir: filepath.Join(home, ".codex", "pets"), source: "codex"})
	}
	return dirs
}

// findPetPackage locates the directory holding pet <id>'s pet.json. Returns ""
// when no scanned dir contains it.
func (s *Server) findPetPackage(id string) (dir, source string) {
	for _, root := range s.petPackageDirs() {
		dir = filepath.Join(root.dir, id)
		if st, err := os.Stat(filepath.Join(dir, "pet.json")); err == nil && !st.IsDir() {
			return dir, root.source
		}
	}
	return "", ""
}

// handleApiPets lists every discovered Codex-compatible pet package.
// Auth-gated: registered with s.auth.Wrap.
func (s *Server) handleApiPets(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	seen := map[string]bool{}
	pets := []petSummary{}
	for _, root := range s.petPackageDirs() {
		entries, err := os.ReadDir(root.dir)
		if err != nil {
			continue
		}
		source := root.source
		for _, e := range entries {
			if !e.IsDir() || seen[e.Name()] {
				continue
			}
			manifestPath := filepath.Join(root.dir, e.Name(), "pet.json")
			data, err := os.ReadFile(manifestPath)
			if err != nil {
				continue
			}
			var m petManifest
			if json.Unmarshal(data, &m) != nil {
				continue
			}
			seen[e.Name()] = true
			id := m.ID
			if id == "" {
				id = e.Name()
			}
			pets = append(pets, petSummary{
				ID:          e.Name(),
				DisplayName: firstNonEmpty(m.DisplayName, id),
				Description: m.Description,
				Source:      source,
			})
		}
	}
	sort.Slice(pets, func(i, j int) bool { return pets[i].ID < pets[j].ID })

	w.Header().Set("Cache-Control", "no-cache")
	writeJSON(w, http.StatusOK, map[string]any{"pets": pets})
}

// handlePetFile serves one file out of a discovered pet package. Only the
// manifest and image assets are served; the id and file name are both
// sanitized to a basename so no path escapes the package dir.
// Auth-gated: registered with s.auth.Wrap.
func (s *Server) handlePetFile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	id := filepath.Base(r.URL.Query().Get("pet"))
	file := filepath.Base(r.URL.Query().Get("file"))
	if id == "" || id == "." || file == "" || file == "." {
		writeJSONError(w, http.StatusBadRequest, "pet and file are required")
		return
	}
	if file != "pet.json" && file != "fio.json" && !isPetImageFile(file) {
		writeJSONError(w, http.StatusForbidden, "unsupported pet file")
		return
	}

	dir, _ := s.findPetPackage(id)
	if dir == "" {
		http.NotFound(w, r)
		return
	}
	path := filepath.Clean(filepath.Join(dir, file))
	if !strings.HasPrefix(path, filepath.Clean(dir)+string(os.PathSeparator)) {
		writeJSONError(w, http.StatusForbidden, "path escapes package")
		return
	}
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		http.NotFound(w, r)
		return
	}

	switch {
	case file == "pet.json" || file == "fio.json":
		w.Header().Set("Content-Type", "application/json")
	case strings.HasSuffix(file, ".webp"):
		w.Header().Set("Content-Type", "image/webp")
	case strings.HasSuffix(file, ".png"):
		w.Header().Set("Content-Type", "image/png")
	}
	w.Header().Set("Cache-Control", "public, max-age=3600")
	http.ServeFile(w, r, path)
}

func isPetImageFile(name string) bool {
	lower := strings.ToLower(name)
	return strings.HasSuffix(lower, ".webp") || strings.HasSuffix(lower, ".png")
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
