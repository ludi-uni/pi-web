package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"pi-web/internal/sessions"
)

func newGitSession(t *testing.T, s *Server, repoDir string) string {
	t.Helper()
	id, err := sessions.CreateSessionFileWithSettings(s.sessionsDir, repoDir, sessions.InitialSettings{})
	if err != nil {
		t.Fatalf("create session: %v", err)
	}
	return id
}

func TestGitStatusEndpoint(t *testing.T) {
	s := newTestServer(t)
	dir := initGitRepo(t)
	os.WriteFile(filepath.Join(dir, "u.txt"), []byte("x\n"), 0644) // untracked
	id := newGitSession(t, s, dir)

	req := httptest.NewRequest(http.MethodGet, "/api/git/status?id="+id, nil)
	w := httptest.NewRecorder()
	s.handleGitStatus(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status: %d %s", w.Code, w.Body.String())
	}
	var st struct {
		IsRepo    bool   `json:"isRepo"`
		Branch    string `json:"branch"`
		Untracked int    `json:"untracked"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &st); err != nil {
		t.Fatal(err)
	}
	if !st.IsRepo || st.Branch != "main" || st.Untracked != 1 {
		t.Fatalf("got %+v", st)
	}
}

func TestGitStatusNonRepo(t *testing.T) {
	s := newTestServer(t)
	id := newGitSession(t, s, t.TempDir()) // not a repo
	req := httptest.NewRequest(http.MethodGet, "/api/git/status?id="+id, nil)
	w := httptest.NewRecorder()
	s.handleGitStatus(w, req)
	var st struct {
		IsRepo bool `json:"isRepo"`
	}
	json.Unmarshal(w.Body.Bytes(), &st)
	if st.IsRepo {
		t.Fatal("expected isRepo=false")
	}
}

func TestGitFilesEndpoint(t *testing.T) {
	s := newTestServer(t)
	dir := initGitRepo(t)
	os.WriteFile(filepath.Join(dir, "new.txt"), []byte("n\n"), 0644)
	id := newGitSession(t, s, dir)

	req := httptest.NewRequest(http.MethodGet, "/api/git/files?id="+id, nil)
	w := httptest.NewRecorder()
	s.handleGitFiles(w, req)
	var res struct {
		IsRepo bool `json:"isRepo"`
		Files  []struct {
			Path   string `json:"path"`
			Status string `json:"status"`
		} `json:"files"`
	}
	json.Unmarshal(w.Body.Bytes(), &res)
	if !res.IsRepo || len(res.Files) != 1 || res.Files[0].Path != "new.txt" {
		t.Fatalf("got %+v", res)
	}
}

func TestGitFileDiffTraversalRejected(t *testing.T) {
	s := newTestServer(t)
	dir := initGitRepo(t)
	id := newGitSession(t, s, dir)
	for _, bad := range []string{"../x", "..", "/abs", "a/../../b"} {
		req := httptest.NewRequest(http.MethodGet, "/api/git/file-diff?id="+id+"&path="+bad, nil)
		w := httptest.NewRecorder()
		s.handleGitFileDiff(w, req)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("path %q: expected 400, got %d", bad, w.Code)
		}
	}
}

func TestGitFileEndpointServesAndGuards(t *testing.T) {
	s := newTestServer(t)
	dir := initGitRepo(t)
	os.WriteFile(filepath.Join(dir, "ok.txt"), []byte("hello\n"), 0644)
	os.WriteFile(filepath.Join(dir, ".env"), []byte("SECRET=1\n"), 0644)
	id := newGitSession(t, s, dir)

	// Normal file → inline text preview.
	req := httptest.NewRequest(http.MethodGet, "/api/git/file?id="+id+"&path=ok.txt", nil)
	w := httptest.NewRecorder()
	s.handleGitFile(w, req)
	if w.Code != http.StatusOK || w.Header().Get("Content-Type") != "text/plain; charset=utf-8" {
		t.Fatalf("preview: %d %v", w.Code, w.Header())
	}

	// Traversal rejected.
	req = httptest.NewRequest(http.MethodGet, "/api/git/file?id="+id+"&path=../escape", nil)
	w = httptest.NewRecorder()
	s.handleGitFile(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("traversal: expected 400, got %d", w.Code)
	}

	// Secret file → forced to attachment (no inline preview).
	req = httptest.NewRequest(http.MethodGet, "/api/git/file?id="+id+"&path=.env", nil)
	w = httptest.NewRecorder()
	s.handleGitFile(w, req)
	if ct := w.Header().Get("Content-Type"); ct == "text/plain; charset=utf-8" {
		t.Fatalf("secret file should not be inline-previewable, got %v", ct)
	}
	if cd := w.Header().Get("Content-Disposition"); cd == "" {
		t.Fatal("secret file should be served as attachment")
	}
}

func TestIsSecretName(t *testing.T) {
	secret := []string{".env", ".env.local", "id_rsa", "server.pem", "api.key",
		"credentials", "credentials.json", "prod.token", "secret.txt", "app.p12"}
	for _, n := range secret {
		if !isSecretName(n) {
			t.Errorf("expected %q flagged as secret", n)
		}
	}
	safe := []string{"tokenizer.js", "mytokenhelper.go", "environment.ts",
		"main.go", "README.md", "secrets-manager/readme.md", "keyword.go"}
	for _, n := range safe {
		if isSecretName(n) {
			t.Errorf("false positive on %q", n)
		}
	}
}
