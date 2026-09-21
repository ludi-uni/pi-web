package server

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"
)

// Approval flow — CONTRACT ONLY. Pi's RPC surface (see internal/rpc/worker.go)
// emits no approval/permission events today, so this file defines the canonical
// event + response contract that a future pi approval stream will plug into,
// plus a pure reducer that is unit-testable now. No real decision is executed:
// the decision endpoint is a stub that records intent and never runs anything.
//
// Pipeline (once pi emits events):
//   pi RPC approval_* line
//     → piRPCWorker.handleRPCLine (new case)
//     → server.reduceApprovalEvent → session_attention.approval_required
//     → broadcast "attention" SSE (existing __all__ topic)
//     → Inbox (existing approval_required kind)
//     → ApprovalCard on the session page
//
// The decision path (pi-web → pi) is a separate approval_response command that
// does not exist yet; this file only fixes its contract.

// Approval action kinds — the closed enum of operations an approval can gate.
// Only kinds pi can actually detect are listed; the enum is forward-extensible
// (new kinds append, never renumber).
type ApprovalKind string

const (
	ApprovalShellCommand       ApprovalKind = "shell_command"
	ApprovalFileWrite          ApprovalKind = "file_write"
	ApprovalFileDelete         ApprovalKind = "file_delete"
	ApprovalGitCommit          ApprovalKind = "git_commit"
	ApprovalGitPush            ApprovalKind = "git_push"
	ApprovalNetworkAction      ApprovalKind = "network_action"
	ApprovalExternalSideEffect ApprovalKind = "external_side_effect"
	ApprovalOther              ApprovalKind = "other"
)

var approvalKinds = map[ApprovalKind]bool{
	ApprovalShellCommand:       true,
	ApprovalFileWrite:          true,
	ApprovalFileDelete:         true,
	ApprovalGitCommit:          true,
	ApprovalGitPush:            true,
	ApprovalNetworkAction:      true,
	ApprovalExternalSideEffect: true,
	ApprovalOther:              true,
}

// ApprovalStatus is the lifecycle of one approval.
type ApprovalStatus string

const (
	ApprovalPending  ApprovalStatus = "pending"
	ApprovalApproved ApprovalStatus = "approved"
	ApprovalRejected ApprovalStatus = "rejected"
	ApprovalExpired  ApprovalStatus = "expired"
)

// Approval is the canonical payload carried by approval_required events.
// Secrets are never placed in Command/Path/Metadata — the producer must
// redact before emitting. Risk is whatever the backend asserted ("" when the
// backend has no opinion); pi-web never infers it.
type Approval struct {
	ID          string         `json:"id"`
	SessionID   string         `json:"sessionId"`
	Kind        ApprovalKind   `json:"kind"`
	Title       string         `json:"title"`
	Description string         `json:"description"`
	Command     string         `json:"command,omitempty"`
	Path        string         `json:"path,omitempty"`
	ToolName    string         `json:"toolName,omitempty"`
	Risk        string         `json:"risk,omitempty"` // backend-asserted only
	CreatedAt   int64          `json:"createdAt"`
	ExpiresAt   int64          `json:"expiresAt,omitempty"`
	Status      ApprovalStatus `json:"status"`
	Metadata    map[string]any `json:"metadata,omitempty"`
}

// approvalEvent is the wire shape of an inbound approval event from pi.
// Field names accept both snake_case and camelCase for forward-compat.
type approvalEvent struct {
	Type       string `json:"type"` // approval_required|resolved|rejected|expired
	ApprovalID string `json:"approval_id"`
	SessionID  string `json:"session_id"`
	Kind       string `json:"action_kind"`
	Title      string `json:"title"`
	Desc       string `json:"description"`
	Command    string `json:"command"`
	Path       string `json:"path"`
	ToolName   string `json:"tool_name"`
	Risk       string `json:"risk_level"`
	CreatedAt  int64  `json:"created_at"`
	ExpiresAt  int64  `json:"expires_at"`
	Decision   string `json:"decision"` // for resolved/rejected
}

// approvalStore tracks pending approvals per session. In-memory for now — the
// real backend will persist alongside session_attention. It enforces the
// contract invariants: unique ids, single decision, stale/expired rejection.
type approvalStore struct {
	mu      sync.Mutex
	pending map[string]*Approval // approvalID → approval
	decided map[string]*Approval // approvalID → decided approval (final status)
}

func newApprovalStore() *approvalStore {
	return &approvalStore{pending: map[string]*Approval{}, decided: map[string]*Approval{}}
}

// normalizeApproval maps a wire event to the canonical Approval. Unknown kind
// → ApprovalOther; missing risk → "". Returns ok=false when the event lacks a
// usable approval id.
func normalizeApproval(ev approvalEvent) (Approval, bool) {
	id := ev.ApprovalID
	if id == "" {
		return Approval{}, false
	}
	kind := ApprovalKind(ev.Kind)
	if !approvalKinds[kind] {
		kind = ApprovalOther
	}
	return Approval{
		ID:          id,
		SessionID:   ev.SessionID,
		Kind:        kind,
		Title:       ev.Title,
		Description: ev.Desc,
		Command:     ev.Command,
		Path:        ev.Path,
		ToolName:    ev.ToolName,
		Risk:        ev.Risk,
		CreatedAt:   ev.CreatedAt,
		ExpiresAt:   ev.ExpiresAt,
		Status:      ApprovalPending,
	}, true
}

// reduce applies an approval event to the store. It returns the resulting
// approval and whether it is still pending. The reducer is the single place
// that enforces the contract invariants.
func (st *approvalStore) reduce(ev approvalEvent, now time.Time) (*Approval, bool) {
	st.mu.Lock()
	defer st.mu.Unlock()

	switch ev.Type {
	case "approval_required":
		a, ok := normalizeApproval(ev)
		if !ok {
			return nil, false
		}
		// Duplicate id → ignore (idempotent; first event wins).
		if _, dup := st.pending[a.ID]; dup {
			return st.pending[a.ID], true
		}
		if prev, already := st.decided[a.ID]; already {
			return prev, false // already decided — a re-required id is stale
		}
		// Already-expired on arrival → record as expired, not pending.
		if a.ExpiresAt > 0 && now.UnixMilli() > a.ExpiresAt {
			a.Status = ApprovalExpired
			st.decided[a.ID] = &a
			return &a, false
		}
		st.pending[a.ID] = &a
		return &a, true

	case "approval_resolved", "approval_rejected", "approval_expired":
		id := ev.ApprovalID
		a, ok := st.pending[id]
		if !ok {
			return nil, false // unknown or already decided → stale, ignore
		}
		var final ApprovalStatus
		switch ev.Type {
		case "approval_resolved":
			final = ApprovalApproved
		case "approval_rejected":
			final = ApprovalRejected
		default:
			final = ApprovalExpired
		}
		a.Status = final
		delete(st.pending, id)
		st.decided[id] = a
		return a, false
	}
	return nil, false
}

// decide records an operator decision for a pending approval. It enforces:
// the approval exists and is still pending (not stale/decided/expired), and a
// decision is applied exactly once (idempotent — a repeat of the same decision
// returns the existing outcome without re-running anything).
func (st *approvalStore) decide(approvalID, decision string, now time.Time) (*Approval, error) {
	st.mu.Lock()
	defer st.mu.Unlock()
	a, ok := st.pending[approvalID]
	if !ok {
		// Idempotent: if already decided with the same outcome, echo it.
		if prev, decided := st.decided[approvalID]; decided {
			want := ApprovalRejected
			if decision == "approve" {
				want = ApprovalApproved
			}
			if prev.Status == want {
				return prev, nil
			}
		}
		return nil, errApprovalNotPending
	}
	if a.ExpiresAt > 0 && now.UnixMilli() > a.ExpiresAt {
		a.Status = ApprovalExpired
		delete(st.pending, approvalID)
		st.decided[approvalID] = a
		return a, errApprovalExpired
	}
	var final ApprovalStatus
	switch decision {
	case "approve":
		final = ApprovalApproved
	case "reject":
		final = ApprovalRejected
	default:
		return nil, errApprovalBadDecision
	}
	a.Status = final
	delete(st.pending, approvalID)
	st.decided[approvalID] = a
	return a, nil
}

// lookup returns a pending or decided approval by id (for broadcast/session
// resolution when reduce already consumed the event).
func (st *approvalStore) lookup(id string) (*Approval, bool) {
	st.mu.Lock()
	defer st.mu.Unlock()
	if a, ok := st.pending[id]; ok {
		return a, true
	}
	if a, ok := st.decided[id]; ok {
		return a, true
	}
	return nil, false
}

var (
	errApprovalNotPending  = errString("approval is not pending")
	errApprovalExpired     = errString("approval has expired")
	errApprovalBadDecision = errString("decision must be approve or reject")
)

type errString string

func (e errString) Error() string { return string(e) }

// approvalPushTitle builds a short, secret-free notification title. It uses
// the action title (or kind) only — never the command/path payload.
func approvalPushTitle(a *Approval) string {
	if a.Title != "" {
		return a.Title
	}
	if a.Kind != "" {
		return "Approval required: " + string(a.Kind)
	}
	return "Approval required"
}

// approvalResponse is the contract pi-web will send back to pi once the
// approval_response RPC command exists. It is defined here so the shape is
// fixed and testable; nothing transmits it yet.
type approvalResponse struct {
	ApprovalID string `json:"approval_id"`
	Decision   string `json:"decision"` // "approve" | "reject"
	DecidedAt  int64  `json:"decided_at"`
}

// approvalDecisionSender is the narrow capability the decision endpoint
// needs: forward a decision to the session's live worker. *workers.Manager
// implements it; test fakes may omit it (→ 503).
type approvalDecisionSender interface {
	SendApprovalResponse(ctx context.Context, sessionID, approvalID, decision string) (json.RawMessage, error)
}

// handleApprovalDecision forwards an operator decision for a pending approval
// to pi via the worker's approval_response RPC. The trust boundary is the
// approval id + decision only — the client never sends the action payload, so
// it can only approve/reject the exact action pi already holds.
//
//	POST /api/approval/decide  {approvalId, decision}
func (s *Server) handleApprovalDecision(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var body struct {
		ApprovalID string `json:"approvalId"`
		Decision   string `json:"decision"`
		SessionID  string `json:"sessionId"`
	}
	if !decodeJSONBody(w, r, &body) {
		return
	}
	if s.approvals == nil {
		s.approvals = newApprovalStore()
	}

	// Validate the approval exists, is pending, and (when the client supplies a
	// session id) belongs to that session — cross-session decisions are refused.
	a, err := s.approvals.decide(body.ApprovalID, body.Decision, time.Now())
	if err != nil {
		status := http.StatusConflict
		if err == errApprovalBadDecision {
			status = http.StatusBadRequest
		}
		writeJSONError(w, status, err.Error())
		return
	}
	if body.SessionID != "" && a.SessionID != "" && a.SessionID != body.SessionID {
		writeJSONError(w, http.StatusConflict, "approval belongs to a different session")
		return
	}

	// Forward the decision to pi. A missing worker means the approval is gone
	// (worker died / restarted) — report it resolved-lost rather than executing.
	executed := false
	var rpcReason string
	if sender, ok := s.chatSender.(approvalDecisionSender); ok && a.SessionID != "" {
		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		data, rpcErr := sender.SendApprovalResponse(ctx, a.SessionID, a.ID, body.Decision)
		cancel()
		if rpcErr != nil {
			// The decision is recorded locally; the RPC failure is surfaced so the
			// UI can show the action did not resume.
			rpcReason = rpcErr.Error()
		} else if len(data) > 0 {
			var res struct {
				Executed bool   `json:"executed"`
				Reason   string `json:"reason"`
			}
			if json.Unmarshal(data, &res) == nil {
				executed = res.Executed
				rpcReason = res.Reason
			}
		}
	}

	// Clear the Inbox flag now that the approval is decided.
	if a.SessionID != "" {
		s.clearApprovalRequired(a.SessionID)
	}
	resp := map[string]any{
		"ok": true, "approvalId": a.ID, "status": a.Status, "executed": executed,
	}
	if rpcReason != "" {
		resp["reason"] = rpcReason
	}
	writeJSON(w, http.StatusOK, resp)
}

// handleListApprovals returns the pending approvals for a session so a freshly
// loaded session page can seed its approval store — covering the race where an
// approval_required SSE fired before the page's listener attached.
//
//	GET /api/approvals?id=<sessionId>
func (s *Server) handleListApprovals(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	sessionID := r.URL.Query().Get("id")
	if sessionID == "" {
		writeJSONError(w, http.StatusBadRequest, "id is required")
		return
	}
	items := []Approval{}
	if s.approvals != nil {
		items = s.approvals.pendingForSession(sessionID)
	}
	writeJSON(w, http.StatusOK, map[string]any{"approvals": items})
}

// pendingForSession returns pending approvals for a session, oldest first.
func (st *approvalStore) pendingForSession(sessionID string) []Approval {
	st.mu.Lock()
	defer st.mu.Unlock()
	out := []Approval{}
	for _, a := range st.pending {
		if a.SessionID == sessionID {
			out = append(out, *a)
		}
	}
	return out
}

// IngestApprovalEvent is the entry point the RPC worker calls when a pi
// approval_* line arrives. It reduces the event and, when a new pending
// approval appears, marks the session attention so the Inbox surfaces it via
// the existing approval_required kind and fires a push notification.
func (s *Server) IngestApprovalEvent(raw json.RawMessage, now time.Time) {
	if s.approvals == nil {
		s.approvals = newApprovalStore()
	}
	var ev approvalEvent
	if json.Unmarshal(raw, &ev) != nil {
		return
	}
	a, pending := s.approvals.reduce(ev, now)
	// Determine the session id for broadcast: prefer the resolved/stored
	// approval's, then the event's. Even when reduce returns nil (already
	// decided locally via the endpoint), the session topic still needs the
	// canonical resolved/rejected event so the open page clears its card.
	sessionID := ev.SessionID
	if a != nil && a.SessionID != "" {
		sessionID = a.SessionID
	}
	if a == nil {
		// Look up a previously-decided approval so resolved events for an
		// endpoint-decided id still reach the session topic.
		if prev, ok := s.approvals.lookup(ev.ApprovalID); ok && prev.SessionID != "" {
			sessionID = prev.SessionID
		}
	}

	if a != nil && pending {
		// Surface via the existing attention pipeline (approval_required kind is
		// already reserved). The session_attention row stores the flag; the Inbox
		// and push reuse it with no new state system.
		s.markApprovalRequired(a.SessionID)
		// Push: short, no command/secret payload — just the action title.
		if s.push != nil && !s.disableBackgroundJobs {
			title := approvalPushTitle(a)
			s.startTask(func(context.Context) {
				s.push.NotifyAttention(a.SessionID, "approval_required", title)
			})
		}
	} else if a != nil {
		// Resolved/rejected/expired → drop the flag.
		s.clearApprovalRequired(a.SessionID)
	}
	// Forward the canonical event to the session topic so an open session
	// page's approval store (and ApprovalCard) reflects it in real time.
	s.broadcastApprovalEvent(ev, sessionID)
}

// broadcastApprovalEvent pushes the approval lifecycle event to the session's
// own SSE topic so the open session page updates its approval store. The
// session page listens for the `approval` event type.
func (s *Server) broadcastApprovalEvent(ev approvalEvent, sessionID string) {
	if sessionID == "" {
		sessionID = ev.SessionID
	}
	if sessionID == "" {
		return
	}
	msg, err := formatSSEJSONEvent("approval", map[string]any{
		"type":        ev.Type,
		"approval_id": ev.ApprovalID,
		"session_id":  sessionID,
		"action_kind": ev.Kind,
		"title":       ev.Title,
		"description": ev.Desc,
		"command":     ev.Command,
		"path":        ev.Path,
		"tool_name":   ev.ToolName,
		"risk_level":  ev.Risk,
		"created_at":  ev.CreatedAt,
		"expires_at":  ev.ExpiresAt,
		"decision":    ev.Decision,
	})
	if err != nil {
		return
	}
	s.broadcast(sessionID, msg)
}
