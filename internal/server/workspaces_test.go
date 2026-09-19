package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"pi-web/internal/sessions"
)

// postWorkspace is a small helper that drives POST /api/workspaces.
func postWorkspace(t *testing.T, s *Server, body map[string]any) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/workspaces", strings.NewReader(mustJSON(t, body)))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.handleUpdateWorkspace(w, req)
	var payload map[string]any
	if w.Code == http.StatusOK {
		if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
			t.Fatalf("decode response: %v", err)
		}
	}
	return w, payload
}

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	data, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return string(data)
}

func getWorkspaces(t *testing.T, s *Server) []workspaceEntry {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/workspaces", nil)
	w := httptest.NewRecorder()
	s.handleApiWorkspaces(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("GET /api/workspaces: %d %s", w.Code, w.Body.String())
	}
	var payload struct {
		Workspaces []workspaceEntry `json:"workspaces"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return payload.Workspaces
}

func TestWorkspaceCreate_DefaultName(t *testing.T) {
	s := newTestServer(t)
	dir := filepath.Join(t.TempDir(), "myproj")

	w, payload := postWorkspace(t, s, map[string]any{"action": "create", "path": dir})
	if w.Code != http.StatusOK {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	ws := payload["workspace"].(map[string]any)
	if ws["name"] != "myproj" {
		t.Fatalf("default name = %v, want myproj", ws["name"])
	}
	if ws["path"] != filepath.Clean(dir) {
		t.Fatalf("path = %v, want %v", ws["path"], filepath.Clean(dir))
	}
	if ws["id"] == "" {
		t.Fatal("id should be generated")
	}
}

func TestWorkspaceCreate_ExplicitName(t *testing.T) {
	s := newTestServer(t)
	dir := t.TempDir()

	w, payload := postWorkspace(t, s, map[string]any{
		"action": "create", "path": dir, "name": "Custom Name",
	})
	if w.Code != http.StatusOK {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	if payload["workspace"].(map[string]any)["name"] != "Custom Name" {
		t.Fatalf("name = %v", payload["workspace"].(map[string]any)["name"])
	}
}

func TestWorkspaceCreate_DuplicatePathReturnsExisting(t *testing.T) {
	s := newTestServer(t)
	dir := t.TempDir()

	_, first := postWorkspace(t, s, map[string]any{"action": "create", "path": dir})
	firstID := first["workspace"].(map[string]any)["id"]

	w, second := postWorkspace(t, s, map[string]any{"action": "create", "path": dir})
	if w.Code != http.StatusOK {
		t.Fatalf("duplicate create should not error, got %d", w.Code)
	}
	if second["existing"] != true {
		t.Fatal("duplicate create should mark existing=true")
	}
	if second["workspace"].(map[string]any)["id"] != firstID {
		t.Fatal("duplicate create should return the existing workspace")
	}
	if got := getWorkspaces(t, s); len(got) != 1 {
		t.Fatalf("expected 1 workspace, got %d", len(got))
	}
}

func TestWorkspaceCreate_RejectsRelativePath(t *testing.T) {
	s := newTestServer(t)
	w, _ := postWorkspace(t, s, map[string]any{"action": "create", "path": "relative/dir"})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("relative path should be 400, got %d", w.Code)
	}
	w, _ = postWorkspace(t, s, map[string]any{"action": "create", "path": ""})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("empty path should be 400, got %d", w.Code)
	}
}

func TestWorkspaceCreate_NormalizesPath(t *testing.T) {
	s := newTestServer(t)
	base := t.TempDir()
	messy := filepath.Join(base, "a", "..", "b")

	w, payload := postWorkspace(t, s, map[string]any{"action": "create", "path": messy})
	if w.Code != http.StatusOK {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	want := filepath.Join(base, "b")
	if payload["workspace"].(map[string]any)["path"] != want {
		t.Fatalf("path = %v, want normalized %v", payload["workspace"].(map[string]any)["path"], want)
	}
}

func TestWorkspaceRename(t *testing.T) {
	s := newTestServer(t)
	_, payload := postWorkspace(t, s, map[string]any{"action": "create", "path": t.TempDir()})
	id := payload["workspace"].(map[string]any)["id"].(string)

	w, _ := postWorkspace(t, s, map[string]any{"action": "rename", "id": id, "name": "Renamed"})
	if w.Code != http.StatusOK {
		t.Fatalf("rename: %d %s", w.Code, w.Body.String())
	}
	if got := getWorkspaces(t, s); got[0].Name != "Renamed" {
		t.Fatalf("name = %v", got[0].Name)
	}

	// Empty name rejected.
	w, _ = postWorkspace(t, s, map[string]any{"action": "rename", "id": id, "name": "  "})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("empty rename should be 400, got %d", w.Code)
	}
	// Unknown id → 404.
	w, _ = postWorkspace(t, s, map[string]any{"action": "rename", "id": "nope", "name": "x"})
	if w.Code != http.StatusNotFound {
		t.Fatalf("rename unknown id should be 404, got %d", w.Code)
	}
}

func TestWorkspacePinUnpin(t *testing.T) {
	s := newTestServer(t)
	_, payload := postWorkspace(t, s, map[string]any{"action": "create", "path": t.TempDir()})
	id := payload["workspace"].(map[string]any)["id"].(string)

	if w, _ := postWorkspace(t, s, map[string]any{"action": "pin", "id": id}); w.Code != http.StatusOK {
		t.Fatalf("pin: %d", w.Code)
	}
	if got := getWorkspaces(t, s); !got[0].Pinned {
		t.Fatal("should be pinned")
	}
	if w, _ := postWorkspace(t, s, map[string]any{"action": "unpin", "id": id}); w.Code != http.StatusOK {
		t.Fatalf("unpin: %d", w.Code)
	}
	if got := getWorkspaces(t, s); got[0].Pinned {
		t.Fatal("should be unpinned")
	}
}

func TestWorkspaceTouch(t *testing.T) {
	s := newTestServer(t)
	_, payload := postWorkspace(t, s, map[string]any{"action": "create", "path": t.TempDir()})
	id := payload["workspace"].(map[string]any)["id"].(string)

	if got := getWorkspaces(t, s); got[0].LastOpenedAt != "" {
		t.Fatal("lastOpenedAt should start empty")
	}
	w, resp := postWorkspace(t, s, map[string]any{"action": "touch", "id": id})
	if w.Code != http.StatusOK {
		t.Fatalf("touch: %d", w.Code)
	}
	if resp["lastOpenedAt"] == "" {
		t.Fatal("touch should return lastOpenedAt")
	}
	if got := getWorkspaces(t, s); got[0].LastOpenedAt == "" {
		t.Fatal("lastOpenedAt should be set after touch")
	}
}

func TestWorkspaceRemove_RegistryOnly(t *testing.T) {
	s := newTestServer(t)
	dir := t.TempDir()

	// Seed a session file under the workspace path so we can prove remove
	// leaves sessions on disk untouched.
	if _, err := sessionsCreateForTest(t, s, dir); err != nil {
		t.Fatalf("create session: %v", err)
	}
	// And a project_prefs row.
	if _, err := s.db.Exec(
		"INSERT INTO project_prefs (project_path, enabled, source) VALUES (?, 1, 'registered')",
		filepath.Clean(dir)); err != nil {
		t.Fatalf("seed project_prefs: %v", err)
	}

	_, payload := postWorkspace(t, s, map[string]any{"action": "create", "path": dir})
	id := payload["workspace"].(map[string]any)["id"].(string)

	w, _ := postWorkspace(t, s, map[string]any{"action": "remove", "id": id})
	if w.Code != http.StatusOK {
		t.Fatalf("remove: %d", w.Code)
	}
	if got := getWorkspaces(t, s); len(got) != 0 {
		t.Fatalf("expected 0 workspaces, got %d", len(got))
	}

	// Sessions still on disk.
	summaries, err := s.loadSummaries()
	if err != nil {
		t.Fatalf("loadSummaries: %v", err)
	}
	if len(summaries) != 1 {
		t.Fatalf("session file should survive workspace removal, got %d summaries", len(summaries))
	}
	// project_prefs row untouched.
	var count int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM project_prefs").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("project_prefs row should survive, got %d", count)
	}
	// Directory untouched.
	if _, err := filepath.Glob(filepath.Join(dir, "*")); err != nil {
		t.Fatalf("workspace dir unreadable: %v", err)
	}

	// Unknown id → 404.
	w, _ = postWorkspace(t, s, map[string]any{"action": "remove", "id": "nope"})
	if w.Code != http.StatusNotFound {
		t.Fatalf("remove unknown id should be 404, got %d", w.Code)
	}
}

func TestWorkspaceOrdering(t *testing.T) {
	s := newTestServer(t)
	mk := func(name string) string {
		_, p := postWorkspace(t, s, map[string]any{
			"action": "create", "path": t.TempDir(), "name": name,
		})
		return p["workspace"].(map[string]any)["id"].(string)
	}
	idB := mk("bravo")
	idA := mk("alpha")
	idC := mk("charlie")

	// Unpinned: most recently touched first; never-touched ordered by name.
	postWorkspace(t, s, map[string]any{"action": "touch", "id": idC})
	got := getWorkspaces(t, s)
	if got[0].ID != idC {
		t.Fatalf("touched workspace should sort first, got %v", got[0].Name)
	}
	// Remaining by name asc.
	if got[1].Name != "alpha" || got[2].Name != "bravo" {
		t.Fatalf("name ordering wrong: %v, %v", got[1].Name, got[2].Name)
	}

	// Pinned beats touched.
	postWorkspace(t, s, map[string]any{"action": "pin", "id": idA})
	got = getWorkspaces(t, s)
	if got[0].ID != idA {
		t.Fatalf("pinned should sort first, got %v", got[0].Name)
	}
	_ = idB
}

func TestWorkspaceSessionCount(t *testing.T) {
	s := newTestServer(t)
	dir := t.TempDir()
	if _, err := sessionsCreateForTest(t, s, dir); err != nil {
		t.Fatalf("create session: %v", err)
	}
	postWorkspace(t, s, map[string]any{"action": "create", "path": dir})
	got := getWorkspaces(t, s)
	if len(got) != 1 || got[0].SessionCount != 1 {
		t.Fatalf("sessionCount = %v, want 1", got)
	}
}

func TestWorkspaceUpdateSettings(t *testing.T) {
	s := newTestServer(t)
	_, payload := postWorkspace(t, s, map[string]any{"action": "create", "path": t.TempDir()})
	id := payload["workspace"].(map[string]any)["id"].(string)

	settings := map[string]any{
		"model":            "openai/gpt-5",
		"permissionPreset": "full",
		"quickPrompts": []map[string]string{
			{"id": "q1", "label": "Test", "prompt": "run tests"},
		},
	}
	w, resp := postWorkspace(t, s, map[string]any{
		"action": "update-settings", "id": id, "settings": settings,
	})
	if w.Code != http.StatusOK {
		t.Fatalf("update-settings: %d %s", w.Code, w.Body.String())
	}
	got := getWorkspaces(t, s)
	if len(got) != 1 {
		t.Fatalf("expected 1 workspace, got %d", len(got))
	}
	var stored map[string]any
	if err := json.Unmarshal(got[0].Settings, &stored); err != nil {
		t.Fatalf("settings not returned: %v", err)
	}
	if stored["model"] != "openai/gpt-5" || stored["permissionPreset"] != "full" {
		t.Fatalf("stored settings = %v", stored)
	}
	qp := stored["quickPrompts"].([]any)
	if len(qp) != 1 || qp[0].(map[string]any)["label"] != "Test" {
		t.Fatalf("quickPrompts = %v", qp)
	}
	_ = resp
}

func TestWorkspaceUpdateSettings_RejectsMalformed(t *testing.T) {
	s := newTestServer(t)
	_, payload := postWorkspace(t, s, map[string]any{"action": "create", "path": t.TempDir()})
	id := payload["workspace"].(map[string]any)["id"].(string)

	// quickPrompts must be an array.
	w, _ := postWorkspace(t, s, map[string]any{
		"action": "update-settings", "id": id,
		"settings": map[string]any{"quickPrompts": "not-an-array"},
	})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("bad quickPrompts should be 400, got %d", w.Code)
	}
	// model must be a string.
	w, _ = postWorkspace(t, s, map[string]any{
		"action": "update-settings", "id": id,
		"settings": map[string]any{"model": 123},
	})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("numeric model should be 400, got %d", w.Code)
	}
	// quick prompt missing fields.
	w, _ = postWorkspace(t, s, map[string]any{
		"action": "update-settings", "id": id,
		"settings": map[string]any{"quickPrompts": []map[string]string{{"id": "x"}}},
	})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("incomplete quick prompt should be 400, got %d", w.Code)
	}
}

func TestWorkspaceUpdateSettings_PreservesUnknownFields(t *testing.T) {
	s := newTestServer(t)
	_, payload := postWorkspace(t, s, map[string]any{"action": "create", "path": t.TempDir()})
	id := payload["workspace"].(map[string]any)["id"].(string)

	postWorkspace(t, s, map[string]any{
		"action": "update-settings", "id": id,
		"settings": map[string]any{"model": "m1", "futureField": "keep-me"},
	})
	postWorkspace(t, s, map[string]any{
		"action": "update-settings", "id": id,
		"settings": map[string]any{"permissionPreset": "full"},
	})

	got := getWorkspaces(t, s)
	var stored map[string]any
	if err := json.Unmarshal(got[0].Settings, &stored); err != nil {
		t.Fatal(err)
	}
	if stored["model"] != "m1" || stored["permissionPreset"] != "full" || stored["futureField"] != "keep-me" {
		t.Fatalf("unknown field not preserved: %v", stored)
	}
}

func TestWorkspaceUpdateSettings_UnknownWorkspace(t *testing.T) {
	s := newTestServer(t)
	w, _ := postWorkspace(t, s, map[string]any{
		"action": "update-settings", "id": "nope",
		"settings": map[string]any{"model": "x"},
	})
	if w.Code != http.StatusNotFound {
		t.Fatalf("unknown workspace should be 404, got %d", w.Code)
	}
}

func TestWorkspaceUnknownAction(t *testing.T) {
	s := newTestServer(t)
	w, _ := postWorkspace(t, s, map[string]any{"action": "explode"})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("unknown action should be 400, got %d", w.Code)
	}
}

func TestWorkspaceCreate_LinksKnownProject(t *testing.T) {
	s := newTestServer(t)
	dir := filepath.Clean(t.TempDir())
	if _, err := s.db.Exec(
		"INSERT INTO project_prefs (project_path, enabled, source) VALUES (?, 1, 'registered')",
		dir); err != nil {
		t.Fatal(err)
	}
	_, payload := postWorkspace(t, s, map[string]any{"action": "create", "path": dir})
	if payload["workspace"].(map[string]any)["projectPath"] != dir {
		t.Fatalf("projectPath = %v, want %v",
			payload["workspace"].(map[string]any)["projectPath"], dir)
	}
}

// sessionsCreateForTest writes a real session file for dir through the same
// path the /api/new-session handler uses.
func sessionsCreateForTest(t *testing.T, s *Server, dir string) (string, error) {
	t.Helper()
	return sessions.CreateSessionFileWithSettings(s.sessionsDir, dir, sessions.InitialSettings{})
}
