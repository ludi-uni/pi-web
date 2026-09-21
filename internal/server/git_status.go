package server

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"pi-web/internal/git"
)

// Read-only git endpoints backing the Result Card and the per-file diff
// viewer. All resolve the session's cwd server-side (never a client path) and
// pass repo-relative paths through git.ValidateRepoPath, so no client input
// reaches a shell or escapes the work tree.

// handleGitStatus returns the Result-Card summary for the session's repo.
//
//	GET /api/git/status?id=<sessionId>
func (s *Server) handleGitStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	_, cwd, err := s.resolveSessionCwd(r.URL.Query().Get("id"))
	if resolveOrWriteError(w, err) {
		return
	}
	status, err := git.WorkingTreeStatus(cwd)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"isRepo": false})
		return
	}
	writeJSON(w, http.StatusOK, status)
}

// handleGitFiles returns the per-file working-tree list for the session's repo.
//
//	GET /api/git/files?id=<sessionId>
func (s *Server) handleGitFiles(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	_, cwd, err := s.resolveSessionCwd(r.URL.Query().Get("id"))
	if resolveOrWriteError(w, err) {
		return
	}
	mode, err := git.ParseDiffMode(r.URL.Query().Get("mode"))
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}
	files, err := git.ChangedFilesMode(cwd, mode)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"isRepo": false, "files": []any{}})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"isRepo": true, "mode": string(mode), "files": files})
}

// handleGitHead returns HEAD + upstream metadata for the Result Card.
//
//	GET /api/git/head?id=<sessionId>
func (s *Server) handleGitHead(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	_, cwd, err := s.resolveSessionCwd(r.URL.Query().Get("id"))
	if resolveOrWriteError(w, err) {
		return
	}
	info, err := git.Head(cwd)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"isRepo": false})
		return
	}
	info.IsRepo = info.SHA != "" || info.Subject != ""
	writeJSON(w, http.StatusOK, info)
}

// handleGitFileDiff returns the unified patch for one repo-relative path.
//
//	GET /api/git/file-diff?id=<sessionId>&path=<repo-relative-path>
func (s *Server) handleGitFileDiff(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	_, cwd, err := s.resolveSessionCwd(r.URL.Query().Get("id"))
	if resolveOrWriteError(w, err) {
		return
	}
	rel := r.URL.Query().Get("path")
	if rel == "" {
		writeJSONError(w, http.StatusBadRequest, "path is required")
		return
	}
	mode, err := git.ParseDiffMode(r.URL.Query().Get("mode"))
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}
	diff, err := git.FileDiffMode(cwd, rel, mode)
	if err != nil {
		if errors.Is(err, git.ErrPathOutsideRepo) {
			writeJSONError(w, http.StatusBadRequest, "path escapes repository")
			return
		}
		if errors.Is(err, git.ErrNotRepo) {
			writeJSON(w, http.StatusOK, map[string]any{"isRepo": false, "diff": ""})
			return
		}
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"isRepo": true, "path": rel, "mode": string(mode), "diff": diff})
}

// Files we refuse to render as an inline preview (they can still be
// downloaded). Matched case-insensitively against the basename.
var secretPreviewPatterns = []string{
	".env", ".pem", ".key", ".crt", ".p12", ".pfx", ".keystore",
	"id_rsa", "id_dsa", "id_ecdsa", "id_ed25519",
	"credentials", "secrets", "token", "secret",
}

// isSecretName reports whether a basename looks like it may hold credentials,
// so the file endpoint marks it non-previewable instead of leaking contents.
// Matching is deliberately conservative: an exact basename, a known sensitive
// extension, or a whole-word token ("token", "secret", "credentials") bounded
// by separators — so "tokenizer.js" or "mytokenhelper.go" are NOT flagged.
func isSecretName(rel string) bool {
	base := strings.ToLower(filepath.Base(rel))
	ext := strings.ToLower(filepath.Ext(base))
	// .env and every .env.* variant are always sensitive.
	if base == ".env" || strings.HasPrefix(base, ".env.") {
		return true
	}
	for _, pat := range secretPreviewPatterns {
		if base == pat {
			return true
		}
		// Sensitive extensions (.pem, .key, .crt, .p12, .pfx, .keystore).
		if strings.HasPrefix(pat, ".") && ext == pat {
			return true
		}
		// Whole-word match for word-like patterns (token, secret, credentials,
		// id_rsa, …): must be bounded by a non-alphanumeric separator or an edge.
		if !strings.HasPrefix(pat, ".") && containsWord(base, pat) {
			return true
		}
	}
	return false
}

// containsWord reports whether s contains word bounded by start/end or a
// non-alphanumeric separator (so "token" matches "api.token" and
// "token-prod" but not "tokenizer").
func containsWord(s, word string) bool {
	idx := 0
	for {
		i := strings.Index(s[idx:], word)
		if i < 0 {
			return false
		}
		i += idx
		before := i == 0 || !isAlnum(s[i-1])
		after := i+len(word) >= len(s) || !isAlnum(s[i+len(word)])
		if before && after {
			return true
		}
		idx = i + 1
	}
}

func isAlnum(b byte) bool {
	return (b >= 'a' && b <= 'z') || (b >= '0' && b <= '9') || b == '_'
}

const (
	// maxPreviewBytes caps inline previews so a big/binary file isn't pulled
	// wholesale into the browser. Larger files are served for download only.
	maxPreviewBytes = 256 << 10 // 256 KiB
	// maxServeBytes is the absolute ceiling for the file endpoint.
	maxServeBytes = 8 << 20 // 8 MiB
)

// handleGitFile serves a single repo-relative file for preview or download.
//
//	GET /api/git/file?id=<sessionId>&path=<repo-relative-path>[&download=1]
//
// Security: the path is validated to stay inside the work tree (traversal +
// symlink escape rejected), the size is capped, and secret-looking names are
// never returned as an inline preview (download still allowed).
func (s *Server) handleGitFile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	_, cwd, err := s.resolveSessionCwd(r.URL.Query().Get("id"))
	if resolveOrWriteError(w, err) {
		return
	}
	rel := r.URL.Query().Get("path")
	if rel == "" {
		writeJSONError(w, http.StatusBadRequest, "path is required")
		return
	}
	if err := git.ValidateRepoPath(cwd, rel); err != nil {
		writeJSONError(w, http.StatusBadRequest, "path escapes repository")
		return
	}
	full := filepath.Join(cwd, filepath.FromSlash(rel))
	info, err := os.Stat(full)
	if err != nil || !info.Mode().IsRegular() {
		writeJSONError(w, http.StatusNotFound, "file not found")
		return
	}
	if info.Size() > maxServeBytes {
		writeJSONError(w, http.StatusRequestEntityTooLarge, "file too large")
		return
	}

	download := r.URL.Query().Get("download") == "1"

	data, err := os.ReadFile(full)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "failed to read file")
		return
	}

	// Safe image types get an inline preview with their real MIME (still inside
	// the size cap and never a secret name). Everything else previews as text
	// only when small + non-secret + non-binary.
	imgMime := imageMIME(data, rel)
	secret := isSecretName(rel)
	binary := git.IsBinaryData(data)
	previewable := info.Size() <= maxPreviewBytes && !secret && !download

	w.Header().Set("X-Content-Type-Options", "nosniff")
	switch {
	case download || secret || info.Size() > maxServeBytes:
		// Explicit download / secret / oversized → attachment.
		w.Header().Set("Content-Disposition",
			`attachment; filename="`+sanitizeFilename(filepath.Base(rel))+`"`)
		w.Header().Set("Content-Type", "application/octet-stream")
	case imgMime != "" && previewable:
		// Safe image → inline preview.
		w.Header().Set("Content-Type", imgMime)
	case binary || !previewable:
		w.Header().Set("Content-Disposition",
			`attachment; filename="`+sanitizeFilename(filepath.Base(rel))+`"`)
		w.Header().Set("Content-Type", "application/octet-stream")
	default:
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	}
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

// imageMIME returns the safe image Content-Type for a file, sniffed from the
// magic bytes (not the extension) so a renamed file can't spoof a type. Only
// png/jpeg/webp/gif are previewable; svg and anything else return "".
func imageMIME(data []byte, rel string) string {
	ext := strings.ToLower(filepath.Ext(rel))
	switch ext {
	case ".png", ".jpg", ".jpeg", ".webp", ".gif":
	default:
		return ""
	}
	switch {
	case len(data) >= 8 && string(data[:8]) == "\x89PNG\r\n\x1a\n":
		return "image/png"
	case len(data) >= 3 && data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF:
		return "image/jpeg"
	case len(data) >= 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WEBP":
		return "image/webp"
	case len(data) >= 6 && (string(data[:6]) == "GIF87a" || string(data[:6]) == "GIF89a"):
		return "image/gif"
	}
	return ""
}

// sanitizeFilename strips characters that could break the Content-Disposition
// header or be interpreted as a path by a browser.
func sanitizeFilename(name string) string {
	name = filepath.Base(name)
	var b strings.Builder
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9',
			r == '.', r == '-', r == '_', r == ' ':
			b.WriteRune(r)
		default:
			b.WriteRune('_')
		}
	}
	out := b.String()
	if out == "" || out == "." {
		return "file"
	}
	return out
}
