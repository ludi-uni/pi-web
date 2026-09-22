package server

import (
	"database/sql"
	"net/http"
	"sort"
	"strings"
	"time"

	"pi-web/internal/sessions"
)

// session_attention is the server-side record of "does this session need the
// user right now". It is deliberately separate from the append-only JSONL so
// read/unread state can be shared across devices without touching session
// data. Rows are created lazily — a session with no row is simply "none".
const attentionSchema = `CREATE TABLE IF NOT EXISTS session_attention (
	session_id      TEXT PRIMARY KEY,
	waiting         INTEGER NOT NULL DEFAULT 0,
	failed          INTEGER NOT NULL DEFAULT 0,
	approval        INTEGER NOT NULL DEFAULT 0,
	completed_at    TEXT,
	last_viewed_at  TEXT,
	updated_at      TEXT NOT NULL
)`

// attentionApprovalColumn migrates older DBs that predate the approval flag.
// SQLite has no IF NOT EXISTS for ADD COLUMN, so the error is swallowed when
// the column already exists.
const attentionApprovalColumn = `ALTER TABLE session_attention ADD COLUMN approval INTEGER NOT NULL DEFAULT 0`

// attentionState is the JSON shape served to the client. CompletedAt is the
// last time the session transitioned running→idle; LastViewedAt is the last
// time the session page was opened. The client derives "completed unread" from
// completed_at > last_viewed_at.
type attentionState struct {
	SessionID    string `json:"sessionId"`
	Waiting      bool   `json:"waiting"`
	Failed       bool   `json:"failed"`
	Approval     bool   `json:"approval"`
	CompletedAt  string `json:"completedAt,omitempty"`
	LastViewedAt string `json:"lastViewedAt,omitempty"`
}

// attentionKind classifies what a session needs. Order in needsAttention
// defines the Inbox grouping priority.
type attentionKind string

const (
	attentionNone     attentionKind = ""
	attentionWaiting  attentionKind = "waiting_input"
	attentionApproval attentionKind = "approval_required" // reserved for a future approval flow
	attentionFailed   attentionKind = "failed"
	attentionUnread   attentionKind = "completed_unread"
	attentionRunning  attentionKind = "running"
)

// needsAttention maps (execution state, attention row) to the single canonical
// bucket the Inbox uses. Running is reported separately and never counts
// toward the "needs attention" total.
func needsAttention(running bool, a attentionState) attentionKind {
	switch {
	case a.Approval:
		return attentionApproval
	case a.Waiting:
		return attentionWaiting
	case a.Failed:
		return attentionFailed
	case running:
		return attentionRunning
	case a.CompletedAt != "" && a.CompletedAt > a.LastViewedAt:
		return attentionUnread
	default:
		return attentionNone
	}
}

// askQuestionToolNames are the tool names whose toolResult with
// details.awaitingChatReply=true means "pi is waiting for the user". Kept as a
// set so both the extension tool (pi_web_ask_user_question) and any future
// built-in alias resolve the same way.
var askQuestionToolNames = map[string]bool{
	"pi_web_ask_user_question": true,
	"ask_user_question":        true,
}

// scanAttentionTail inspects the tail of a session's entries and reports the
// attention flags to record when the session just went idle. It reads the
// parsed session (already cached by the caller's resolve) rather than the raw
// file, so it stays cheap.
//
// waiting: an ask-question toolResult with details.awaitingChatReply=true that
// has no user message after it (the user hasn't replied yet).
// failed:  the session's *final* state is a failure. Concretely, the last
// message is either (a) an errored toolResult with no successful toolResult
// after it (pi didn't recover), or (b) an assistant message that ends on a
// toolCall that never got a result (crashed mid-tool). An error followed by a
// successful retry is a normal completed turn, not a failure.
func scanAttentionTail(entries []map[string]any) (waiting, failed bool) {
	// Find the index of the last user message; anything before it is settled.
	lastUserIdx := -1
	for i := len(entries) - 1; i >= 0; i-- {
		if msg, ok := entries[i]["message"].(map[string]any); ok {
			if role, _ := msg["role"].(string); role == "user" {
				lastUserIdx = i
				break
			}
		}
	}

	// resolvedCalls tracks which toolCall ids got a toolResult, so a toolCall
	// left dangling at the end means the turn died mid-tool.
	resolvedCalls := map[string]bool{}
	var lastAssistantMsg map[string]any
	lastEntryIsMessage := false
	lastIsErrorResult := false

	for i := len(entries) - 1; i > lastUserIdx; i-- {
		raw := entries[i]
		if raw["type"] != "message" {
			continue
		}
		msg, ok := raw["message"].(map[string]any)
		if !ok {
			continue
		}
		role, _ := msg["role"].(string)
		if !lastEntryIsMessage {
			lastEntryIsMessage = true
			if role == "toolResult" {
				lastIsErrorResult, _ = msg["isError"].(bool)
			}
		}
		switch role {
		case "toolResult":
			if id, _ := msg["toolCallId"].(string); id != "" {
				resolvedCalls[id] = true
			}
			// Awaiting-chat-reply marker: pi asked a question and stopped.
			if !waiting {
				toolName, _ := msg["toolName"].(string)
				if askQuestionToolNames[toolName] {
					if details, ok := msg["details"].(map[string]any); ok {
						if awaiting, _ := details["awaitingChatReply"].(bool); awaiting {
							waiting = true
						}
					}
				}
			}
		case "assistant":
			if lastAssistantMsg == nil {
				lastAssistantMsg = msg
			}
		}
	}

	// failed only when the terminal state is a failure:
	//  - the last message is an errored toolResult (pi surfaced the error and
	//    stopped, no successful retry after it)
	//  - the last assistant message ends on a toolCall that never got a result
	//    (crashed mid-tool)
	// An error followed by a successful toolResult is a recovered turn — the
	// last message is then a success or a plain text reply, so neither branch
	// fires and the session reads as a normal completion.
	if lastIsErrorResult {
		failed = true
	}
	if !failed && lastAssistantMsg != nil {
		if content, ok := lastAssistantMsg["content"].([]any); ok && len(content) > 0 {
			if block, ok := content[len(content)-1].(map[string]any); ok && block["type"] == "toolCall" {
				if id, _ := block["id"].(string); id != "" && !resolvedCalls[id] {
					failed = true
				}
			}
		}
	}
	return waiting, failed
}

// markSessionViewed records that the session page was opened now. Debounced by
// the caller; safe to call from the read path because it only writes when the
// stored timestamp is meaningfully older.
func (s *Server) markSessionViewed(sessionID string) {
	if s.db == nil || sessionID == "" {
		return
	}
	now := s.now().UTC().Format(time.RFC3339)
	// Only write when the previous view is older than a minute — the session
	// page re-fetches on every SSE reload, and we don't want each reload to
	// count as a fresh "view" that resets unread too aggressively.
	var prev string
	var completedAt sql.NullString
	_ = s.db.QueryRow(`SELECT last_viewed_at, completed_at FROM session_attention WHERE session_id = ?`, sessionID).
		Scan(&prev, &completedAt)
	// A completion recorded after the last view means the user is looking at a
	// session that just finished — always let the ping mark it read, even inside
	// the debounce window. Otherwise watching a run end leaves a phantom
	// "completed unread" inbox entry (RFC3339 compares correctly as strings).
	unreadCompletion := completedAt.Valid && completedAt.String > prev
	if prev != "" && !unreadCompletion {
		if t, err := time.Parse(time.RFC3339, prev); err == nil && s.now().Sub(t) < time.Minute {
			return
		}
	}
	_, err := s.db.Exec(`INSERT INTO session_attention (session_id, last_viewed_at, updated_at)
		VALUES (?, ?, ?)
		ON CONFLICT(session_id) DO UPDATE SET last_viewed_at=excluded.last_viewed_at, updated_at=excluded.updated_at`,
		sessionID, now, now)
	if err == nil {
		s.broadcastAttention(sessionID)
	}
}

// markApprovalRequired sets the approval flag on a session's attention row
// and broadcasts it so open index pages surface the session under the
// approval_required Inbox group. Called by the (future) approval event
// pipeline; harmless to call before any real approval backend exists.
func (s *Server) markApprovalRequired(sessionID string) {
	if s.db == nil || sessionID == "" {
		return
	}
	now := s.now().UTC().Format(time.RFC3339)
	_, err := s.db.Exec(`INSERT INTO session_attention (session_id, approval, updated_at)
		VALUES (?, 1, ?)
		ON CONFLICT(session_id) DO UPDATE SET approval=1, updated_at=excluded.updated_at`,
		sessionID, now)
	if err == nil {
		s.broadcastAttention(sessionID)
	}
}

// clearApprovalRequired clears the approval flag once the approval is decided
// or expires, so the Inbox stops showing it.
func (s *Server) clearApprovalRequired(sessionID string) {
	if s.db == nil || sessionID == "" {
		return
	}
	now := s.now().UTC().Format(time.RFC3339)
	if _, err := s.db.Exec(`UPDATE session_attention SET approval=0, updated_at=? WHERE session_id=?`, now, sessionID); err == nil {
		s.broadcastAttention(sessionID)
	}
}

// updateAttentionOnIdle runs when a session transitions running→idle. It
// resolves the session, scans the tail for waiting/failed signals, records
// completed_at, and returns the attention kind that just became active so the
// caller can decide whether to push.
func (s *Server) updateAttentionOnIdle(sessionID string) attentionKind {
	if s.db == nil {
		return attentionNone
	}
	resolved, err := sessions.ResolveByID(s.sessionsDir, sessionID)
	if err != nil {
		return attentionNone
	}
	waiting, failed := scanAttentionTail(resolved.Session.Entries)
	now := s.now().UTC().Format(time.RFC3339)

	// Read the previous flags so we only push on a real state change (dedupe).
	var prevWaiting, prevFailed bool
	var prevCompleted string
	_ = s.db.QueryRow(`SELECT waiting, failed, completed_at FROM session_attention WHERE session_id = ?`, sessionID).
		Scan(&prevWaiting, &prevFailed, &prevCompleted)

	_, err = s.db.Exec(`INSERT INTO session_attention (session_id, waiting, failed, completed_at, updated_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(session_id) DO UPDATE SET
			waiting=excluded.waiting, failed=excluded.failed,
			completed_at=excluded.completed_at, updated_at=excluded.updated_at`,
		sessionID, waiting, failed, now, now)
	if err != nil {
		return attentionNone
	}
	s.broadcastAttention(sessionID)

	// Decide what (if anything) is newly active for push dedupe. Waiting and
	// failed only notify on a flag change so a session stuck in the same state
	// can't spam; a plain completion notifies on every running→idle transition
	// (the standard "response ready" push).
	if waiting {
		if !prevWaiting {
			return attentionWaiting
		}
		return attentionNone
	}
	if failed {
		if !prevFailed {
			return attentionFailed
		}
		return attentionNone
	}
	return attentionUnread
}

// clearAttentionFlags drops waiting/failed when a session starts running again
// (the user replied or a new prompt superseded the question). completed_at and
// last_viewed_at are left alone — they're history, not flags.
func (s *Server) clearAttentionFlags(sessionID string) {
	if s.db == nil || sessionID == "" {
		return
	}
	res, err := s.db.Exec(`UPDATE session_attention SET waiting=0, failed=0, updated_at=?
		WHERE session_id = ? AND (waiting != 0 OR failed != 0)`,
		s.now().UTC().Format(time.RFC3339), sessionID)
	if err == nil {
		if n, _ := res.RowsAffected(); n > 0 {
			s.broadcastAttention(sessionID)
		}
	}
}

// attentionForSession reads the stored row for one session. Missing row →
// zero-value state.
func (s *Server) attentionForSession(sessionID string) attentionState {
	a := attentionState{SessionID: sessionID}
	if s.db == nil || sessionID == "" {
		return a
	}
	var waiting, failed, approval int
	var completedAt, lastViewed sql.NullString
	err := s.db.QueryRow(`SELECT waiting, failed, approval, completed_at, last_viewed_at
		FROM session_attention WHERE session_id = ?`, sessionID).
		Scan(&waiting, &failed, &approval, &completedAt, &lastViewed)
	if err != nil {
		return a
	}
	a.Waiting = waiting != 0
	a.Failed = failed != 0
	a.Approval = approval != 0
	if completedAt.Valid {
		a.CompletedAt = completedAt.String
	}
	if lastViewed.Valid {
		a.LastViewedAt = lastViewed.String
	}
	return a
}

// attentionMap returns every session's attention row, keyed by session id.
func (s *Server) attentionMap() map[string]attentionState {
	out := map[string]attentionState{}
	if s.db == nil {
		return out
	}
	rows, err := s.db.Query(`SELECT session_id, waiting, failed, approval, completed_at, last_viewed_at FROM session_attention`)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var a attentionState
		var waiting, failed, approval int
		var completedAt, lastViewed sql.NullString
		if err := rows.Scan(&a.SessionID, &waiting, &failed, &approval, &completedAt, &lastViewed); err != nil {
			continue
		}
		a.Waiting = waiting != 0
		a.Failed = failed != 0
		a.Approval = approval != 0
		if completedAt.Valid {
			a.CompletedAt = completedAt.String
		}
		if lastViewed.Valid {
			a.LastViewedAt = lastViewed.String
		}
		out[a.SessionID] = a
	}
	return out
}

// broadcastAttention pushes the updated row for one session to every client on
// the __all__ topic so open index pages refresh the Inbox without polling.
func (s *Server) broadcastAttention(sessionID string) {
	a := s.attentionForSession(sessionID)
	msg, err := formatSSEJSONEvent("attention", a)
	if err != nil {
		return
	}
	s.broadcast(globalSessID, msg)
}

// handleSessionViewed is the explicit "the user opened this session" ping from
// the session page. Kept separate from GET /api/session because that endpoint
// is also hit by hover-prefetch and SSE reloads, which must not mark a session
// as read.
func (s *Server) handleSessionViewed(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	sessionID := r.URL.Query().Get("id")
	if sessionID == "" {
		writeJSONError(w, http.StatusBadRequest, "id is required")
		return
	}
	s.markSessionViewed(sessionID)
	writeJSON(w, 0, map[string]any{"ok": true})
}

// attentionItem is one Inbox row: the attention state plus the session
// metadata the client needs to render it without a second /api/sessions call.
// This is what lets the Inbox surface needs-attention sessions that fall
// outside the 100-session index page window.
type attentionItem struct {
	attentionState
	Name         string `json:"name"`
	Project      string `json:"project"`
	LastActivity string `json:"lastActivity,omitempty"`
	Kind         string `json:"kind"`
	Running      bool   `json:"running"`
}

// handleAttention serves GET /api/attention: every session that needs
// attention (or is running) as a self-contained list, plus the raw map for
// clients that key by id. Sessions whose file was deleted are skipped.
func (s *Server) handleAttention(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	s.lastKnownMu.Lock()
	runningSet := make(map[string]bool, len(s.lastKnown))
	running := make([]string, 0, len(s.lastKnown))
	for id := range s.lastKnown {
		runningSet[id] = true
		running = append(running, id)
	}
	s.lastKnownMu.Unlock()
	sort.Strings(running)

	attention := s.attentionMap()

	// Resolve metadata for every session that has an attention row or is
	// running. ResolveByID tolerates deleted files (returns an error we skip).
	ids := map[string]bool{}
	for id := range attention {
		ids[id] = true
	}
	for _, id := range running {
		ids[id] = true
	}

	items := make([]attentionItem, 0, len(ids))
	for id := range ids {
		row := attention[id]
		row.SessionID = id
		item := attentionItem{attentionState: row, Running: runningSet[id]}
		if resolved, err := sessions.ResolveByID(s.sessionsDir, id); err == nil {
			item.Name = resolved.Session.Name
			item.Project = resolved.Session.Project
			item.LastActivity = resolved.Session.LastActivity
		}
		item.Kind = string(needsAttention(item.Running, row))
		// Only surface rows that actually need attention or are running.
		if item.Kind == string(attentionNone) {
			continue
		}
		items = append(items, item)
	}
	// Stable order: needs-attention first (waiting, failed, unread), then running.
	sort.Slice(items, func(i, j int) bool {
		return items[i].LastActivity > items[j].LastActivity
	})

	writeJSON(w, 0, map[string]any{
		"attention": attention,
		"running":   running,
		"items":     items,
	})
}

// handleLastViewed serves GET /api/session/last-viewed: the most recently
// viewed session (for "Continue last session"). Returns 404 when nothing has
// been viewed yet or the session file is gone.
func (s *Server) handleLastViewed(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if s.db == nil {
		writeJSONError(w, http.StatusNotFound, "no viewed session")
		return
	}
	var sessionID, lastViewed string
	err := s.db.QueryRow(`SELECT session_id, last_viewed_at FROM session_attention
		WHERE last_viewed_at IS NOT NULL AND last_viewed_at != ''
		ORDER BY last_viewed_at DESC LIMIT 1`).Scan(&sessionID, &lastViewed)
	if err != nil || sessionID == "" {
		writeJSONError(w, http.StatusNotFound, "no viewed session")
		return
	}
	resolved, err := sessions.ResolveByID(s.sessionsDir, sessionID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "session not found")
		return
	}
	writeJSON(w, 0, map[string]any{
		"sessionId":    sessionID,
		"name":         resolved.Session.Name,
		"project":      resolved.Session.Project,
		"lastViewedAt": lastViewed,
	})
}

// attentionTitle returns a short, safe label for a push notification. Prefers
// the session's display name; falls back to the project, then a truncated id.
// Never includes prompt text or message bodies.
func (s *Server) attentionTitle(sessionID string) string {
	if s.cache != nil {
		if resolved, err := s.cache.Resolve(s.sessionsDir, sessionID); err == nil {
			if name := strings.TrimSpace(resolved.Session.Name); name != "" {
				return name
			}
			if project := strings.TrimSpace(resolved.Session.Project); project != "" {
				return project
			}
		}
	}
	if len(sessionID) > 12 {
		return sessionID[:12] + "…"
	}
	return sessionID
}
