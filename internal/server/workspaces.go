package server

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"path/filepath"
	"runtime"
	"sort"
	"strings"

	"github.com/google/uuid"
)

// workspacesSchema creates the registry of user-curated workspaces. A workspace
// is a named, pinnable working directory — the "where do I want to work" entry
// point that sits above sessions. Unlike project_prefs (which only records
// visibility for cwd-derived projects), a workspace row is a first-class
// entity with its own id, display name, and last-opened timestamp.
//
// machine_id and settings_json are reserved for future phases (remote machines
// and per-workspace presets); W1 writes NULL and never reads them.
const workspacesSchema = `CREATE TABLE IF NOT EXISTS workspaces (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	path TEXT NOT NULL UNIQUE,
	project_path TEXT,
	pinned INTEGER NOT NULL DEFAULT 0,
	last_opened_at TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	machine_id TEXT,
	settings_json TEXT
)`

// workspaceEntry is the JSON shape returned by GET /api/workspaces.
type workspaceEntry struct {
	ID           string          `json:"id"`
	Name         string          `json:"name"`
	Path         string          `json:"path"`
	ProjectPath  string          `json:"projectPath,omitempty"`
	Pinned       bool            `json:"pinned"`
	LastOpenedAt string          `json:"lastOpenedAt,omitempty"`
	SessionCount int             `json:"sessionCount"`
	Settings     json.RawMessage `json:"settings,omitempty"`
}

// workspaceSettings is the validated subset of settings_json W4A supports.
// Unknown keys in the stored JSON are preserved verbatim (re-marshaled from
// the raw column), so future fields survive a round-trip through this struct.
type workspaceSettings struct {
	Model            string               `json:"model,omitempty"`
	PermissionPreset string               `json:"permissionPreset,omitempty"`
	QuickPrompts     []workspaceQuickPrompt `json:"quickPrompts,omitempty"`
}

type workspaceQuickPrompt struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	Prompt string `json:"prompt"`
}

// normalizeWorkspacePath applies the same normalization as project
// registration (~ expansion, filepath.Clean, absolute required) so a
// workspace's path matches the cwd recorded in session headers. Symlinks are
// deliberately NOT resolved: a symlinked path is a legitimate distinct
// workspace, and avoiding filesystem I/O keeps registration working for
// not-yet-existing directories (matching CreateSessionFileWithSettings).
func normalizeWorkspacePath(path string) (string, error) {
	return normalizeProjectPath(path)
}

// workspacePathEqual compares two workspace paths. On Windows the filesystem
// is case-insensitive, so drive letters and path segments compare folded;
// everywhere else the comparison is exact.
func workspacePathEqual(a, b string) bool {
	if runtime.GOOS == "windows" {
		return strings.EqualFold(a, b)
	}
	return a == b
}

// defaultWorkspaceName derives a display name from a path — the basename, or
// the full path for roots like "D:\" or "/" whose basename is empty.
func defaultWorkspaceName(path string) string {
	base := filepath.Base(path)
	if base == "." || base == string(filepath.Separator) || base == "" {
		return path
	}
	return base
}

// listWorkspaces returns every registered workspace ordered pinned-first,
// then most recently opened, then name. Session counts are filled from the
// current summaries so the UI can show "N sessions" without a second query.
func (s *Server) listWorkspaces() ([]workspaceEntry, error) {
	out := make([]workspaceEntry, 0)
	if s.db == nil {
		return out, nil
	}
	rows, err := s.db.Query(`SELECT id, name, path, project_path, pinned, last_opened_at, settings_json
		FROM workspaces`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var e workspaceEntry
		var projectPath, lastOpened, settingsJSON sql.NullString
		var pinned int
		if err := rows.Scan(&e.ID, &e.Name, &e.Path, &projectPath, &pinned, &lastOpened, &settingsJSON); err != nil {
			continue
		}
		e.ProjectPath = projectPath.String
		e.Pinned = pinned == 1
		e.LastOpenedAt = lastOpened.String
		if settingsJSON.Valid && settingsJSON.String != "" {
			e.Settings = json.RawMessage(settingsJSON.String)
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Session counts keyed by the session's recorded project (== cwd).
	if summaries, err := s.loadSummaries(); err == nil {
		counts := make(map[string]int)
		for _, sum := range summaries {
			if sum.Project != "" {
				counts[sum.Project]++
			}
		}
		for i := range out {
			// Match case-insensitively on Windows so a workspace registered as
			// "D:\Dev" still counts sessions recorded under "d:\dev".
			for p, n := range counts {
				if workspacePathEqual(out[i].Path, p) {
					out[i].SessionCount += n
				}
			}
		}
	}

	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Pinned != out[j].Pinned {
			return out[i].Pinned
		}
		if out[i].LastOpenedAt != out[j].LastOpenedAt {
			return out[i].LastOpenedAt > out[j].LastOpenedAt
		}
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out, nil
}

// findWorkspaceByPath returns the workspace registered for path, or nil.
func (s *Server) findWorkspaceByPath(path string) *workspaceEntry {
	if s.db == nil {
		return nil
	}
	rows, err := s.db.Query(`SELECT id, name, path, project_path, pinned, last_opened_at, settings_json
		FROM workspaces`)
	if err != nil {
		return nil
	}
	defer rows.Close()
	for rows.Next() {
		var e workspaceEntry
		var projectPath, lastOpened, settingsJSON sql.NullString
		var pinned int
		if err := rows.Scan(&e.ID, &e.Name, &e.Path, &projectPath, &pinned, &lastOpened, &settingsJSON); err != nil {
			continue
		}
		if workspacePathEqual(e.Path, path) {
			e.ProjectPath = projectPath.String
			e.Pinned = pinned == 1
			e.LastOpenedAt = lastOpened.String
			if settingsJSON.Valid && settingsJSON.String != "" {
				e.Settings = json.RawMessage(settingsJSON.String)
			}
			return &e
		}
	}
	return nil
}

func (s *Server) handleApiWorkspaces(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	workspaces, err := s.listWorkspaces()
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, 0, map[string]any{"workspaces": workspaces})
}

func (s *Server) handleUpdateWorkspace(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var body struct {
		ID       string          `json:"id"`
		Path     string          `json:"path"`
		Name     string          `json:"name"`
		Action   string          `json:"action"`
		Settings json.RawMessage `json:"settings"`
	}
	if !decodeJSONBody(w, r, &body) {
		return
	}
	if s.db == nil {
		writeJSONError(w, http.StatusInternalServerError, "workspaces are unavailable")
		return
	}

	now := s.now().UTC().Format("2006-01-02 15:04:05")

	switch body.Action {
	case "create":
		s.createWorkspace(w, body.Path, body.Name, now)
	case "rename":
		s.renameWorkspace(w, body.ID, body.Name, now)
	case "pin", "unpin":
		s.pinWorkspace(w, body.ID, body.Action == "pin", now)
	case "remove":
		s.removeWorkspace(w, body.ID)
	case "touch":
		s.touchWorkspace(w, body.ID, now)
	case "update-settings":
		s.updateWorkspaceSettings(w, body.ID, body.Settings, now)
	default:
		writeJSONError(w, http.StatusBadRequest, "unknown action")
	}
}

func (s *Server) createWorkspace(w http.ResponseWriter, rawPath, name, now string) {
	path, err := normalizeWorkspacePath(rawPath)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}
	name = strings.TrimSpace(name)
	if name == "" {
		name = defaultWorkspaceName(path)
	}

	// Duplicate path → return the existing entry rather than an error, so a
	// double-click or retry is idempotent.
	if existing := s.findWorkspaceByPath(path); existing != nil {
		writeJSON(w, 0, map[string]any{"ok": true, "workspace": existing, "existing": true})
		return
	}

	// project_path links the workspace to the existing project_prefs row when
	// the path is already a known project. Purely informational in W1.
	projectPath := ""
	if s.db != nil {
		var p string
		if err := s.db.QueryRow(
			"SELECT project_path FROM project_prefs WHERE project_path = ?", path,
		).Scan(&p); err == nil {
			projectPath = p
		}
	}

	id := uuid.NewString()
	_, err = s.db.Exec(`INSERT INTO workspaces
		(id, name, path, project_path, pinned, last_opened_at, created_at, updated_at)
		VALUES (?, ?, ?, ?, 0, NULL, ?, ?)`,
		id, name, path, nullableString(projectPath), now, now)
	if err != nil {
		// UNIQUE(path) raced with our existence check — treat as duplicate.
		if existing := s.findWorkspaceByPath(path); existing != nil {
			writeJSON(w, 0, map[string]any{"ok": true, "workspace": existing, "existing": true})
			return
		}
		writeJSONError(w, http.StatusInternalServerError, "failed to create workspace: "+err.Error())
		return
	}
	writeJSON(w, 0, map[string]any{
		"ok": true,
		"workspace": workspaceEntry{
			ID:          id,
			Name:        name,
			Path:        path,
			ProjectPath: projectPath,
		},
	})
}

func (s *Server) renameWorkspace(w http.ResponseWriter, id, name, now string) {
	name = strings.TrimSpace(name)
	if name == "" {
		writeJSONError(w, http.StatusBadRequest, "name is required")
		return
	}
	res, err := s.db.Exec(
		"UPDATE workspaces SET name = ?, updated_at = ? WHERE id = ?", name, now, id)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "failed to rename workspace: "+err.Error())
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeJSONError(w, http.StatusNotFound, "workspace not found")
		return
	}
	writeJSON(w, 0, map[string]any{"ok": true, "id": id, "name": name})
}

func (s *Server) pinWorkspace(w http.ResponseWriter, id string, pinned bool, now string) {
	v := 0
	if pinned {
		v = 1
	}
	res, err := s.db.Exec(
		"UPDATE workspaces SET pinned = ?, updated_at = ? WHERE id = ?", v, now, id)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "failed to update workspace: "+err.Error())
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeJSONError(w, http.StatusNotFound, "workspace not found")
		return
	}
	writeJSON(w, 0, map[string]any{"ok": true, "id": id, "pinned": pinned})
}

func (s *Server) removeWorkspace(w http.ResponseWriter, id string) {
	// Registry-only delete: the directory, its sessions, project_prefs rows,
	// scratchpads, and the git repo are all intentionally untouched.
	res, err := s.db.Exec("DELETE FROM workspaces WHERE id = ?", id)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "failed to remove workspace: "+err.Error())
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeJSONError(w, http.StatusNotFound, "workspace not found")
		return
	}
	writeJSON(w, 0, map[string]any{"ok": true, "id": id})
}

// updateWorkspaceSettings validates and stores the W4A settings subset
// (model, permissionPreset, quickPrompts) into settings_json. Unknown keys in
// the incoming settings are preserved — the validated fields are overlaid onto
// the existing JSON object rather than replacing it, so future fields survive.
func (s *Server) updateWorkspaceSettings(w http.ResponseWriter, id string, raw json.RawMessage, now string) {
	if len(raw) == 0 {
		writeJSONError(w, http.StatusBadRequest, "settings is required")
		return
	}
	// Parse into a generic map first so unknown keys are preserved.
	var incoming map[string]json.RawMessage
	if err := json.Unmarshal(raw, &incoming); err != nil {
		writeJSONError(w, http.StatusBadRequest, "settings must be a JSON object")
		return
	}

	// Validate the known fields; reject malformed values rather than storing
	// them silently.
	var validated workspaceSettings
	if v, ok := incoming["model"]; ok {
		if string(v) != "null" {
			if err := json.Unmarshal(v, &validated.Model); err != nil {
				writeJSONError(w, http.StatusBadRequest, "model must be a string or null")
				return
			}
		}
	}
	if v, ok := incoming["permissionPreset"]; ok {
		if string(v) != "null" {
			if err := json.Unmarshal(v, &validated.PermissionPreset); err != nil {
				writeJSONError(w, http.StatusBadRequest, "permissionPreset must be a string or null")
				return
			}
		}
	}
	if v, ok := incoming["quickPrompts"]; ok {
		if string(v) != "null" {
			var prompts []workspaceQuickPrompt
			if err := json.Unmarshal(v, &prompts); err != nil {
				writeJSONError(w, http.StatusBadRequest, "quickPrompts must be an array or null")
				return
			}
			for _, p := range prompts {
				if p.ID == "" || p.Label == "" || p.Prompt == "" {
					writeJSONError(w, http.StatusBadRequest,
						"each quick prompt needs id, label, and prompt")
					return
				}
			}
			validated.QuickPrompts = prompts
		}
	}

	// Read the existing settings_json so unrelated keys are preserved.
	var existingRaw string
	var existing map[string]json.RawMessage
	if err := s.db.QueryRow("SELECT settings_json FROM workspaces WHERE id = ?", id).
		Scan(&existingRaw); err == nil && existingRaw != "" {
		_ = json.Unmarshal([]byte(existingRaw), &existing)
	}
	if existing == nil {
		existing = make(map[string]json.RawMessage)
	}

	// Overlay the incoming keys (validated ones) onto the existing object.
	for k, v := range incoming {
		existing[k] = v
	}
	merged, err := json.Marshal(existing)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "failed to encode settings")
		return
	}

	res, err := s.db.Exec(
		"UPDATE workspaces SET settings_json = ?, updated_at = ? WHERE id = ?",
		string(merged), now, id)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "failed to save settings: "+err.Error())
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeJSONError(w, http.StatusNotFound, "workspace not found")
		return
	}
	writeJSON(w, 0, map[string]any{"ok": true, "id": id, "settings": json.RawMessage(merged)})
}

func (s *Server) touchWorkspace(w http.ResponseWriter, id, now string) {
	res, err := s.db.Exec(
		"UPDATE workspaces SET last_opened_at = ?, updated_at = ? WHERE id = ?", now, now, id)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "failed to update workspace: "+err.Error())
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeJSONError(w, http.StatusNotFound, "workspace not found")
		return
	}
	writeJSON(w, 0, map[string]any{"ok": true, "id": id, "lastOpenedAt": now})
}

// nullableString maps "" to NULL so optional columns stay clean.
func nullableString(s string) any {
	if s == "" {
		return nil
	}
	return s
}
