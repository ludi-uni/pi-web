package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// fakeApprovalSender is a full ChatSender (embedded fake) plus the optional
// approvalDecisionSender capability, for endpoint tests.
type fakeApprovalSender struct {
	fakeSender
	gotSession, gotID, gotDecision string
	data                           json.RawMessage
	err                            error
}

func (f *fakeApprovalSender) SendApprovalResponse(ctx context.Context, sessionID, approvalID, decision string) (json.RawMessage, error) {
	f.gotSession, f.gotID, f.gotDecision = sessionID, approvalID, decision
	return f.data, f.err
}

func newApprovalServer(t *testing.T, sender *fakeApprovalSender) *Server {
	t.Helper()
	s := newTestServer(t)
	s.chatSender = sender
	s.approvals = newApprovalStore()
	return s
}

func postDecision(t *testing.T, s *Server, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/approval/decide", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.handleApprovalDecision(w, req)
	return w
}

func TestApprovalDecisionForwardsToWorker(t *testing.T) {
	sender := &fakeApprovalSender{data: json.RawMessage(`{"executed":true}`)}
	s := newApprovalServer(t, sender)

	// Seed a pending approval via the ingest path.
	s.IngestApprovalEvent(json.RawMessage(`{"type":"approval_required","approval_id":"a1","session_id":"sess-1","action_kind":"git_push","title":"Git push"}`), time.Now())

	w := postDecision(t, s, `{"approvalId":"a1","decision":"approve","sessionId":"sess-1"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("decide: %d %s", w.Code, w.Body.String())
	}
	if sender.gotID != "a1" || sender.gotDecision != "approve" || sender.gotSession != "sess-1" {
		t.Fatalf("worker got %v/%v/%v", sender.gotSession, sender.gotID, sender.gotDecision)
	}
	var res struct {
		OK       bool   `json:"ok"`
		Status   string `json:"status"`
		Executed bool   `json:"executed"`
	}
	json.Unmarshal(w.Body.Bytes(), &res)
	if !res.OK || res.Status != "approved" || !res.Executed {
		t.Fatalf("got %+v", res)
	}
}

func TestApprovalDecisionMissingApproval(t *testing.T) {
	s := newApprovalServer(t, &fakeApprovalSender{})
	w := postDecision(t, s, `{"approvalId":"ghost","decision":"approve"}`)
	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409 for unknown approval, got %d", w.Code)
	}
}

func TestApprovalDecisionSessionMismatch(t *testing.T) {
	s := newApprovalServer(t, &fakeApprovalSender{})
	s.IngestApprovalEvent(json.RawMessage(`{"type":"approval_required","approval_id":"a1","session_id":"sess-1"}`), time.Now())
	w := postDecision(t, s, `{"approvalId":"a1","decision":"approve","sessionId":"other"}`)
	if w.Code != http.StatusConflict {
		t.Fatalf("session mismatch should be 409, got %d", w.Code)
	}
}

func TestApprovalDecisionAlreadyResolved(t *testing.T) {
	s := newApprovalServer(t, &fakeApprovalSender{})
	s.IngestApprovalEvent(json.RawMessage(`{"type":"approval_required","approval_id":"a1","session_id":"s1"}`), time.Now())
	postDecision(t, s, `{"approvalId":"a1","decision":"approve"}`)
	// Conflicting second decision → 409.
	w := postDecision(t, s, `{"approvalId":"a1","decision":"reject"}`)
	if w.Code != http.StatusConflict {
		t.Fatalf("conflicting re-decision should be 409, got %d", w.Code)
	}
}

func TestApprovalDecisionBadDecision(t *testing.T) {
	s := newApprovalServer(t, &fakeApprovalSender{})
	s.IngestApprovalEvent(json.RawMessage(`{"type":"approval_required","approval_id":"a1","session_id":"s1"}`), time.Now())
	w := postDecision(t, s, `{"approvalId":"a1","decision":"maybe"}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("bad decision should be 400, got %d", w.Code)
	}
}

func TestIngestApprovalSetsAttentionFlag(t *testing.T) {
	s := newTestServer(t)
	s.approvals = newApprovalStore()
	// Need a session row in attention for the flag to surface; markApprovalRequired
	// upserts the row itself, so a fresh session id works.
	s.IngestApprovalEvent(json.RawMessage(`{"type":"approval_required","approval_id":"a1","session_id":"sess-x","action_kind":"git_push","title":"Git push"}`), time.Now())
	a := s.attentionForSession("sess-x")
	if !a.Approval {
		t.Fatal("expected approval flag set on session attention")
	}
	// Resolve → flag clears.
	s.IngestApprovalEvent(json.RawMessage(`{"type":"approval_resolved","approval_id":"a1"}`), time.Now())
	a = s.attentionForSession("sess-x")
	if a.Approval {
		t.Fatal("expected approval flag cleared after resolve")
	}
}
