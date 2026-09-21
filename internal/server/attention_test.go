package server

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"pi-web/internal/sessions"
)

// writeAttentionSession creates a session file whose entries end in the given
// tail. tail is a slice of raw JSONL message lines (already marshaled).
func writeAttentionSession(t *testing.T, sessionsDir, name string, tail []string) string {
	t.Helper()
	dir := filepath.Join(sessionsDir, "proj")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	cwd := filepath.Join(sessionsDir, "cwd")
	if err := os.MkdirAll(cwd, 0o755); err != nil {
		t.Fatal(err)
	}
	content := `{"type":"session","version":3,"id":"sid-` + name + `","timestamp":"2026-05-06T00:00:00.000Z","cwd":` + jsonString(cwd) + `}` + "\n"
	for _, line := range tail {
		content += line + "\n"
	}
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func userMsg(id string) string {
	return `{"type":"message","id":"` + id + `","parentId":null,"timestamp":"2026-05-06T00:00:01.000Z","message":{"role":"user","content":"hi"}}`
}
func assistantText(id string) string {
	return `{"type":"message","id":"` + id + `","timestamp":"2026-05-06T00:00:02.000Z","message":{"role":"assistant","content":[{"type":"text","text":"ok"}]}}`
}
func askQuestionCall(id, callID string) string {
	return `{"type":"message","id":"` + id + `","timestamp":"2026-05-06T00:00:03.000Z","message":{"role":"assistant","content":[{"type":"toolCall","id":"` + callID + `","name":"pi_web_ask_user_question","arguments":{"questions":[{"question":"Pick one","options":["a","b"]}]}}]}}`
}
func askQuestionResult(id, callID string, awaiting bool) string {
	awaitingStr := "false"
	if awaiting {
		awaitingStr = "true"
	}
	return `{"type":"message","id":"` + id + `","timestamp":"2026-05-06T00:00:04.000Z","message":{"role":"toolResult","toolCallId":"` + callID + `","toolName":"pi_web_ask_user_question","content":[{"type":"text","text":"q"}],"details":{"awaitingChatReply":` + awaitingStr + `},"isError":false}}`
}
func toolResultError(id string) string {
	return `{"type":"message","id":"` + id + `","timestamp":"2026-05-06T00:00:05.000Z","message":{"role":"toolResult","toolCallId":"c1","toolName":"powershell","content":[{"type":"text","text":"boom"}],"isError":true}}`
}

func TestScanAttentionTail_Waiting(t *testing.T) {
	sessionsDir := t.TempDir()
	writeAttentionSession(t, sessionsDir, "w.jsonl", []string{
		userMsg("u1"),
		askQuestionCall("a1", "call1"),
		askQuestionResult("r1", "call1", true),
	})
	resolved, err := sessions.ResolveByID(sessionsDir, "w.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	waiting, failed := scanAttentionTail(resolved.Session.Entries)
	if !waiting {
		t.Fatal("expected waiting=true for unanswered ask_user_question")
	}
	if failed {
		t.Fatal("expected failed=false")
	}
}

func TestScanAttentionTail_WaitingClearedByUserReply(t *testing.T) {
	sessionsDir := t.TempDir()
	writeAttentionSession(t, sessionsDir, "w.jsonl", []string{
		userMsg("u1"),
		askQuestionCall("a1", "call1"),
		askQuestionResult("r1", "call1", true),
		userMsg("u2"), // user replied after the question
		assistantText("a2"),
	})
	resolved, err := sessions.ResolveByID(sessionsDir, "w.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	waiting, _ := scanAttentionTail(resolved.Session.Entries)
	if waiting {
		t.Fatal("expected waiting=false once the user replied")
	}
}

func TestScanAttentionTail_Failed(t *testing.T) {
	sessionsDir := t.TempDir()
	writeAttentionSession(t, sessionsDir, "f.jsonl", []string{
		userMsg("u1"),
		assistantText("a1"),
		toolResultError("r1"),
	})
	resolved, err := sessions.ResolveByID(sessionsDir, "f.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	_, failed := scanAttentionTail(resolved.Session.Entries)
	if !failed {
		t.Fatal("expected failed=true when last entry is an errored toolResult")
	}
}

func TestScanAttentionTail_CompletedClean(t *testing.T) {
	sessionsDir := t.TempDir()
	writeAttentionSession(t, sessionsDir, "c.jsonl", []string{
		userMsg("u1"),
		assistantText("a1"),
	})
	resolved, err := sessions.ResolveByID(sessionsDir, "c.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	waiting, failed := scanAttentionTail(resolved.Session.Entries)
	if waiting || failed {
		t.Fatalf("expected clean completion, got waiting=%v failed=%v", waiting, failed)
	}
}

func TestNeedsAttentionMapping(t *testing.T) {
	cases := []struct {
		name    string
		running bool
		row     attentionState
		want    attentionKind
	}{
		{"waiting", false, attentionState{Waiting: true}, attentionWaiting},
		{"failed", false, attentionState{Failed: true}, attentionFailed},
		{"running", true, attentionState{}, attentionRunning},
		{"unread", false, attentionState{CompletedAt: "2026-05-06T00:00:10Z", LastViewedAt: "2026-05-06T00:00:05Z"}, attentionUnread},
		{"read", false, attentionState{CompletedAt: "2026-05-06T00:00:05Z", LastViewedAt: "2026-05-06T00:00:10Z"}, attentionNone},
		{"idle none", false, attentionState{}, attentionNone},
		{"waiting beats running", true, attentionState{Waiting: true}, attentionWaiting},
	}
	for _, c := range cases {
		if got := needsAttention(c.running, c.row); got != c.want {
			t.Errorf("%s: needsAttention() = %q, want %q", c.name, got, c.want)
		}
	}
}

// newAttentionServer builds a Server with a real SQLite DB in a temp dir so the
// attention handlers exercise the actual persistence path.
func newAttentionServer(t *testing.T) *Server {
	t.Helper()
	root := t.TempDir()
	sessionsDir := filepath.Join(root, "sessions")
	if err := os.MkdirAll(sessionsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	db, err := initDB(root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return &Server{
		agentDir:    root,
		sessionsDir: sessionsDir,
		db:          db,
		chatSender:  &fakeSender{},
		clients:     make([]*sseClient, 0),
		lastKnown:   make(map[string]struct{}),
		fileMod:     make(map[string]time.Time),
		now:         time.Now,
	}
}

func TestMarkSessionViewedAndUnread(t *testing.T) {
	s := newAttentionServer(t)
	writeAttentionSession(t, s.sessionsDir, "s.jsonl", []string{userMsg("u1"), assistantText("a1")})

	// Simulate a completion: record completed_at in the past.
	s.updateAttentionOnIdle("s.jsonl")
	row := s.attentionForSession("s.jsonl")
	if row.CompletedAt == "" {
		t.Fatal("expected completed_at to be recorded")
	}
	if got := needsAttention(false, row); got != attentionUnread {
		t.Fatalf("expected unread before view, got %q", got)
	}

	// Mark viewed → unread clears.
	s.markSessionViewed("s.jsonl")
	row = s.attentionForSession("s.jsonl")
	if row.LastViewedAt == "" {
		t.Fatal("expected last_viewed_at to be recorded")
	}
	if got := needsAttention(false, row); got != attentionNone {
		t.Fatalf("expected none after view, got %q", got)
	}
}

func TestAttentionEndpointAndViewedEndpoint(t *testing.T) {
	s := newAttentionServer(t)
	writeAttentionSession(t, s.sessionsDir, "s.jsonl", []string{
		userMsg("u1"), askQuestionCall("a1", "c1"), askQuestionResult("r1", "c1", true),
	})
	s.updateAttentionOnIdle("s.jsonl")

	// GET /api/attention
	req := httptest.NewRequest("GET", "/api/attention", nil)
	rec := httptest.NewRecorder()
	s.handleAttention(rec, req)
	var body struct {
		Attention map[string]attentionState `json:"attention"`
		Running   []string                  `json:"running"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if !body.Attention["s.jsonl"].Waiting {
		t.Fatal("expected waiting=true in /api/attention")
	}

	// POST /api/session/viewed
	req = httptest.NewRequest("POST", "/api/session/viewed?id=s.jsonl", nil)
	rec = httptest.NewRecorder()
	s.handleSessionViewed(rec, req)
	if rec.Code != 200 {
		t.Fatalf("viewed status = %d", rec.Code)
	}
	if s.attentionForSession("s.jsonl").LastViewedAt == "" {
		t.Fatal("expected last_viewed_at after viewed ping")
	}
}

func TestScanAttentionTail_RecoveredErrorNotFailed(t *testing.T) {
	sessionsDir := t.TempDir()
	// error toolResult → successful toolResult → assistant text. The session
	// recovered, so it must not read as failed.
	writeAttentionSession(t, sessionsDir, "r.jsonl", []string{
		userMsg("u1"),
		`{"type":"message","id":"a1","timestamp":"2026-05-06T00:00:02.000Z","message":{"role":"assistant","content":[{"type":"toolCall","id":"c1","name":"powershell","arguments":{}}]}}`,
		toolResultError("r1"),
		`{"type":"message","id":"a2","timestamp":"2026-05-06T00:00:06.000Z","message":{"role":"assistant","content":[{"type":"toolCall","id":"c2","name":"read","arguments":{}}]}}`,
		`{"type":"message","id":"r2","timestamp":"2026-05-06T00:00:07.000Z","message":{"role":"toolResult","toolCallId":"c2","toolName":"read","content":[{"type":"text","text":"ok"}],"isError":false}}`,
		assistantText("a3"),
	})
	resolved, err := sessions.ResolveByID(sessionsDir, "r.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	_, failed := scanAttentionTail(resolved.Session.Entries)
	if failed {
		t.Fatal("expected failed=false after a recovered tool error")
	}
}

func TestScanAttentionTail_DanglingThenContinuation(t *testing.T) {
	sessionsDir := t.TempDir()
	// A dangling toolCall (c1, no result) followed by a later resolved call (c2)
	// and a text reply — the turn continued past the dangling call.
	writeAttentionSession(t, sessionsDir, "d.jsonl", []string{
		userMsg("u1"),
		`{"type":"message","id":"a1","timestamp":"2026-05-06T00:00:02.000Z","message":{"role":"assistant","content":[{"type":"toolCall","id":"c1","name":"powershell","arguments":{}}]}}`,
		`{"type":"message","id":"a2","timestamp":"2026-05-06T00:00:03.000Z","message":{"role":"assistant","content":[{"type":"toolCall","id":"c2","name":"read","arguments":{}}]}}`,
		`{"type":"message","id":"r2","timestamp":"2026-05-06T00:00:04.000Z","message":{"role":"toolResult","toolCallId":"c2","toolName":"read","content":[{"type":"text","text":"ok"}],"isError":false}}`,
		assistantText("a3"),
	})
	resolved, err := sessions.ResolveByID(sessionsDir, "d.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	_, failed := scanAttentionTail(resolved.Session.Entries)
	if failed {
		t.Fatal("expected failed=false when a later call resolved and the turn completed")
	}
}

func TestScanAttentionTail_DanglingIsFailed(t *testing.T) {
	sessionsDir := t.TempDir()
	// Assistant ends on a toolCall with no result — crashed mid-tool.
	writeAttentionSession(t, sessionsDir, "d.jsonl", []string{
		userMsg("u1"),
		`{"type":"message","id":"a1","timestamp":"2026-05-06T00:00:02.000Z","message":{"role":"assistant","content":[{"type":"toolCall","id":"c1","name":"powershell","arguments":{}}]}}`,
	})
	resolved, err := sessions.ResolveByID(sessionsDir, "d.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	_, failed := scanAttentionTail(resolved.Session.Entries)
	if !failed {
		t.Fatal("expected failed=true for a dangling toolCall")
	}
}

func TestAttentionEndpoint_ReturnsMetadata(t *testing.T) {
	s := newAttentionServer(t)
	writeAttentionSession(t, s.sessionsDir, "meta.jsonl", []string{
		userMsg("u1"), askQuestionCall("a1", "c1"), askQuestionResult("r1", "c1", true),
	})
	s.updateAttentionOnIdle("meta.jsonl")

	req := httptest.NewRequest("GET", "/api/attention", nil)
	rec := httptest.NewRecorder()
	s.handleAttention(rec, req)
	var body struct {
		Items []attentionItem `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(body.Items))
	}
	item := body.Items[0]
	if item.SessionID != "meta.jsonl" || item.Name == "" || item.Project == "" {
		t.Fatalf("item missing metadata: %+v", item)
	}
	if item.Kind != string(attentionWaiting) {
		t.Fatalf("kind = %q, want waiting_input", item.Kind)
	}
}

func TestLastViewedEndpoint(t *testing.T) {
	s := newAttentionServer(t)
	writeAttentionSession(t, s.sessionsDir, "v.jsonl", []string{userMsg("u1"), assistantText("a1")})

	// Nothing viewed → 404.
	req := httptest.NewRequest("GET", "/api/session/last-viewed", nil)
	rec := httptest.NewRecorder()
	s.handleLastViewed(rec, req)
	if rec.Code != 404 {
		t.Fatalf("expected 404 before any view, got %d", rec.Code)
	}

	s.markSessionViewed("v.jsonl")
	rec = httptest.NewRecorder()
	s.handleLastViewed(rec, req)
	if rec.Code != 200 {
		t.Fatalf("expected 200 after view, got %d", rec.Code)
	}
	var body struct {
		SessionID string `json:"sessionId"`
		Name      string `json:"name"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.SessionID != "v.jsonl" {
		t.Fatalf("sessionId = %q, want v.jsonl", body.SessionID)
	}
}

func TestClearAttentionFlagsOnRunning(t *testing.T) {
	s := newAttentionServer(t)
	writeAttentionSession(t, s.sessionsDir, "s.jsonl", []string{
		userMsg("u1"), askQuestionCall("a1", "c1"), askQuestionResult("r1", "c1", true),
	})
	s.updateAttentionOnIdle("s.jsonl")
	if !s.attentionForSession("s.jsonl").Waiting {
		t.Fatal("expected waiting before clear")
	}
	s.clearAttentionFlags("s.jsonl")
	if s.attentionForSession("s.jsonl").Waiting {
		t.Fatal("expected waiting cleared after running transition")
	}
}
