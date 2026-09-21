package server

import (
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
)

// handleApiBrowseDirs lists immediate subdirectories of a path for the "Add
// workspace" folder picker. Unlike /api/files (which is scoped to a session's
// cwd), browsing here is deliberately unrestricted — the user is picking an
// arbitrary working directory, which is exactly what the free-text path field
// already allows. Listing names only (no file contents) keeps exposure minimal.
//
// Query params:
//
//	?path=<abs path>  — list its subdirectories; empty means the default
//	                    browse root (home dir, or drive list on Windows).
//
// Response: { path, parent, dirs: [name...] }. parent is "" at roots.
func (s *Server) handleApiBrowseDirs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	raw := strings.TrimSpace(r.URL.Query().Get("path"))
	if raw == "" {
		s.browseRoot(w, r)
		return
	}

	path, err := normalizeWorkspacePath(raw)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}
	info, err := os.Stat(path)
	if err != nil || !info.IsDir() {
		writeJSONError(w, http.StatusBadRequest, "not a directory")
		return
	}

	dirents, err := os.ReadDir(path)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	dirs := make([]string, 0, len(dirents))
	for _, d := range dirents {
		if !d.IsDir() {
			continue
		}
		// Skip hidden and heavy generated directories — they are never a
		// useful workspace root and only add noise.
		name := d.Name()
		if strings.HasPrefix(name, ".") || name == "node_modules" {
			continue
		}
		dirs = append(dirs, name)
	}
	sort.Strings(dirs)

	parent := filepath.Dir(path)
	if parent == path {
		parent = ""
	}
	writeJSON(w, 0, map[string]any{
		"path":   path,
		"parent": parent,
		"dirs":   dirs,
	})
}

// browseRoot responds to a bare /api/browse-dirs call. On Windows the useful
// root is the list of drive roots (D:\, C:\, …); elsewhere it is the user's
// home directory.
func (s *Server) browseRoot(w http.ResponseWriter, r *http.Request) {
	if runtime.GOOS == "windows" {
		drives := make([]string, 0, 8)
		for c := 'A'; c <= 'Z'; c++ {
			root := string(c) + `:\`
			if info, err := os.Stat(root); err == nil && info.IsDir() {
				drives = append(drives, root)
			}
		}
		writeJSON(w, 0, map[string]any{"path": "", "parent": "", "dirs": drives})
		return
	}
	home, err := os.UserHomeDir()
	if err != nil {
		home = string(filepath.Separator)
	}
	// Recurse into the normal path branch by rewriting the request — simpler
	// than duplicating the listing logic.
	q := r.URL.Query()
	q.Set("path", home)
	r.URL.RawQuery = q.Encode()
	s.handleApiBrowseDirs(w, r)
}
