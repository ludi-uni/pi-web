package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"testing"

	"pi-web/internal/git"
	"pi-web/internal/sessions"
)

// initGitRepo mirrors internal/git's test helper: a real repo on "main" with
// one empty commit so CurrentBranch/DefaultBranch resolve deterministically.
func initGitRepo(t *testing.T) string {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not available")
	}
	dir := t.TempDir()
	mustGit := func(args ...string) {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v (%s)", args, err, out)
		}
	}
	mustGit("init")
	mustGit("config", "user.email", "test@example.com")
	mustGit("config", "user.name", "Test")
	mustGit("commit", "--allow-empty", "-m", "init")
	mustGit("branch", "-M", "main")
	return dir
}

func getGitInfo(t *testing.T, s *Server, query string) (*httptest.ResponseRecorder, git.Info) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/git/info?"+query, nil)
	w := httptest.NewRecorder()
	s.handleGitInfo(w, req)
	var info git.Info
	if w.Code == http.StatusOK {
		if err := json.Unmarshal(w.Body.Bytes(), &info); err != nil {
			t.Fatalf("decode git info: %v", err)
		}
	}
	return w, info
}

func TestGitInfo_BySessionID(t *testing.T) {
	s := newTestServer(t)
	dir := initGitRepo(t)

	id, err := sessions.CreateSessionFileWithSettings(s.sessionsDir, dir, sessions.InitialSettings{})
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	w, info := getGitInfo(t, s, "id="+id)
	if w.Code != http.StatusOK {
		t.Fatalf("id lookup: %d %s", w.Code, w.Body.String())
	}
	if !info.IsRepo || info.Branch != "main" {
		t.Fatalf("got %+v, want repo on main", info)
	}
}

func TestGitInfo_ByWorkspacePath(t *testing.T) {
	s := newTestServer(t)
	dir := initGitRepo(t)

	// Register the repo path as a workspace.
	if _, p := postWorkspace(t, s, map[string]any{"action": "create", "path": dir}); p == nil {
		t.Fatal("create workspace failed")
	}

	w, info := getGitInfo(t, s, "path="+dir)
	if w.Code != http.StatusOK {
		t.Fatalf("path lookup: %d %s", w.Code, w.Body.String())
	}
	if !info.IsRepo || info.Branch != "main" {
		t.Fatalf("got %+v, want repo on main", info)
	}
	if info.HasChanges {
		t.Fatal("fresh repo should be clean")
	}
}

func TestGitInfo_PathNonRepo(t *testing.T) {
	s := newTestServer(t)
	dir := t.TempDir() // not a git repo
	postWorkspace(t, s, map[string]any{"action": "create", "path": dir})

	w, info := getGitInfo(t, s, "path="+dir)
	if w.Code != http.StatusOK {
		t.Fatalf("non-repo path: %d %s", w.Code, w.Body.String())
	}
	if info.IsRepo {
		t.Fatal("expected IsRepo=false for non-git workspace")
	}
}

func TestGitInfo_PathRequiresRegisteredWorkspace(t *testing.T) {
	s := newTestServer(t)
	dir := initGitRepo(t) // a real repo, but NOT registered as a workspace

	w, _ := getGitInfo(t, s, "path="+dir)
	if w.Code != http.StatusNotFound {
		t.Fatalf("unregistered path should be 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestGitInfo_PathRejectsRelative(t *testing.T) {
	s := newTestServer(t)
	w, _ := getGitInfo(t, s, "path=relative/dir")
	if w.Code != http.StatusBadRequest {
		t.Fatalf("relative path should be 400, got %d", w.Code)
	}
}

func TestGitInfo_IDTakesPrecedenceOverPath(t *testing.T) {
	s := newTestServer(t)
	repoDir := initGitRepo(t)
	otherDir := t.TempDir()

	id, err := sessions.CreateSessionFileWithSettings(s.sessionsDir, repoDir, sessions.InitialSettings{})
	if err != nil {
		t.Fatalf("create session: %v", err)
	}
	// Register the *other* dir so path would resolve to a non-repo if used.
	postWorkspace(t, s, map[string]any{"action": "create", "path": otherDir})

	w, info := getGitInfo(t, s, "id="+id+"&path="+otherDir)
	if w.Code != http.StatusOK {
		t.Fatalf("id+path: %d %s", w.Code, w.Body.String())
	}
	// id won: the session's repo is described, not the non-repo workspace path.
	if !info.IsRepo || info.Branch != "main" {
		t.Fatalf("id should take precedence; got %+v", info)
	}
}

func TestGitInfo_NoParams(t *testing.T) {
	s := newTestServer(t)
	w, _ := getGitInfo(t, s, "")
	if w.Code != http.StatusBadRequest {
		t.Fatalf("missing params should be 400, got %d", w.Code)
	}
}
