package server

import (
	"errors"
	"net/http"

	"pi-web/internal/git"
	"pi-web/internal/sessions"
)

// resolveSessionCwd resolves a session id to its working directory (the cwd
// recorded in the session header).
func (s *Server) resolveSessionCwd(id string) (sessions.ResolvedSession, string, error) {
	var resolved sessions.ResolvedSession
	var err error
	if s.cache != nil {
		resolved, err = s.cache.Resolve(s.sessionsDir, id)
	} else {
		resolved, err = sessions.ResolveByID(s.sessionsDir, id)
	}
	if err != nil {
		return resolved, "", err
	}
	cwd, _ := resolved.Session.Header["cwd"].(string)
	return resolved, cwd, nil
}

// resolveOrWriteError maps a session-resolution error to an HTTP status and
// writes the response, returning true when err was non-nil (and thus handled).
// Callers use `if resolveOrWriteError(w, err) { return }`.
func resolveOrWriteError(w http.ResponseWriter, err error) bool {
	if err == nil {
		return false
	}
	switch {
	case errors.Is(err, sessions.ErrInvalidSessionID):
		writeJSONError(w, http.StatusBadRequest, "invalid session id")
	case errors.Is(err, sessions.ErrSessionNotFound):
		writeJSONError(w, http.StatusNotFound, "session not found")
	default:
		writeJSONError(w, http.StatusInternalServerError, err.Error())
	}
	return true
}

// handleGitInfo returns the current branch and a GitHub PR URL for the
// session's working directory. Non-repo cwds return {isRepo:false}.
//
// Two lookup modes:
//   ?id=<sessionId>   — resolve the session's cwd (original behavior)
//   ?path=<abs path>  — describe a registered workspace's path directly
//
// The path form is intentionally restricted to paths present in the
// workspaces registry so this endpoint cannot be used to probe arbitrary
// filesystem locations. When both are given, id wins.
func (s *Server) handleGitInfo(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	q := r.URL.Query()
	if id := q.Get("id"); id != "" {
		_, cwd, err := s.resolveSessionCwd(id)
		if resolveOrWriteError(w, err) {
			return
		}
		info, _ := git.Describe(cwd)
		writeJSON(w, 0, info)
		return
	}
	if rawPath := q.Get("path"); rawPath != "" {
		path, err := normalizeWorkspacePath(rawPath)
		if err != nil {
			writeJSONError(w, http.StatusBadRequest, err.Error())
			return
		}
		// Only describe paths the user has actually registered as workspaces.
		if s.findWorkspaceByPath(path) == nil {
			writeJSONError(w, http.StatusNotFound, "workspace not found for path")
			return
		}
		info, _ := git.Describe(path)
		writeJSON(w, 0, info)
		return
	}
	writeJSONError(w, http.StatusBadRequest, "id or path is required")
}

// handleGitRenameBranch renames the checked-out branch in the session's cwd.
func (s *Server) handleGitRenameBranch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var body struct {
		Name string `json:"name"`
	}
	if !decodeJSONBody(w, r, &body) {
		return
	}
	_, cwd, err := s.resolveSessionCwd(r.URL.Query().Get("id"))
	if resolveOrWriteError(w, err) {
		return
	}
	branch, err := git.RenameBranch(cwd, body.Name)
	if err != nil {
		switch {
		case errors.Is(err, git.ErrInvalidBranchName):
			writeJSONError(w, http.StatusBadRequest, "invalid branch name")
		case errors.Is(err, git.ErrDefaultBranch):
			writeJSONError(w, http.StatusBadRequest, "refusing to rename the default branch")
		case errors.Is(err, git.ErrNotRepo):
			writeJSONError(w, http.StatusBadRequest, "not a git repository")
		default:
			writeJSONError(w, http.StatusBadRequest, err.Error())
		}
		return
	}
	writeJSON(w, 0, map[string]any{"ok": true, "branch": branch})
}
