package server

import (
	"testing"
	"time"
)

func ev(typ, id string) approvalEvent {
	return approvalEvent{Type: typ, ApprovalID: id, SessionID: "s1"}
}

func TestNormalizeApproval(t *testing.T) {
	a, ok := normalizeApproval(approvalEvent{
		ApprovalID: "a1", SessionID: "s1", Kind: "shell_command",
		Title: "Deploy", Command: "npm publish", Risk: "high", CreatedAt: 5,
	})
	if !ok {
		t.Fatal("expected ok")
	}
	if a.Kind != ApprovalShellCommand || a.Command != "npm publish" || a.Risk != "high" {
		t.Fatalf("got %+v", a)
	}
	if a.Status != ApprovalPending {
		t.Fatalf("expected pending, got %v", a.Status)
	}
	// Unknown kind → other; missing id → not ok.
	if a2, _ := normalizeApproval(approvalEvent{ApprovalID: "x", Kind: "bogus"}); a2.Kind != ApprovalOther {
		t.Fatalf("unknown kind should map to other, got %v", a2.Kind)
	}
	if _, ok := normalizeApproval(approvalEvent{}); ok {
		t.Fatal("missing id should not be ok")
	}
}

func TestApprovalReduceRequiredAndResolve(t *testing.T) {
	st := newApprovalStore()
	now := time.UnixMilli(1000)
	a, pending := st.reduce(ev("approval_required", "a1"), now)
	if !pending || a == nil || a.Status != ApprovalPending {
		t.Fatalf("expected pending approval, got %+v pending=%v", a, pending)
	}
	// Resolve.
	a2, pending := st.reduce(approvalEvent{Type: "approval_resolved", ApprovalID: "a1"}, now)
	if pending || a2.Status != ApprovalApproved {
		t.Fatalf("expected resolved, got %+v", a2)
	}
}

func TestApprovalDuplicateIdIgnored(t *testing.T) {
	st := newApprovalStore()
	now := time.UnixMilli(0)
	st.reduce(ev("approval_required", "a1"), now)
	// Second required with same id → still pending, not duplicated.
	a, pending := st.reduce(ev("approval_required", "a1"), now)
	if !pending || len(st.pending) != 1 {
		t.Fatalf("duplicate id should be idempotent, got %d pending", len(st.pending))
	}
	_ = a
}

func TestApprovalExpiredOnArrival(t *testing.T) {
	st := newApprovalStore()
	now := time.UnixMilli(2000)
	e := ev("approval_required", "a1")
	e.ExpiresAt = 1000 // already past
	a, pending := st.reduce(e, now)
	if pending || a.Status != ApprovalExpired {
		t.Fatalf("expected expired, got %+v pending=%v", a, pending)
	}
}

func TestApprovalStaleResolveIgnored(t *testing.T) {
	st := newApprovalStore()
	now := time.UnixMilli(0)
	// Resolve an id that was never required → ignored.
	a, pending := st.reduce(approvalEvent{Type: "approval_resolved", ApprovalID: "ghost"}, now)
	if a != nil || pending {
		t.Fatalf("stale resolve should be ignored, got %+v", a)
	}
	// Resolve twice → second is stale.
	st.reduce(ev("approval_required", "a1"), now)
	st.reduce(approvalEvent{Type: "approval_resolved", ApprovalID: "a1"}, now)
	a2, _ := st.reduce(approvalEvent{Type: "approval_resolved", ApprovalID: "a1"}, now)
	if a2 != nil {
		t.Fatal("second resolve should be ignored")
	}
}

func TestApprovalDecideIdempotent(t *testing.T) {
	st := newApprovalStore()
	now := time.UnixMilli(0)
	st.reduce(ev("approval_required", "a1"), now)
	a, err := st.decide("a1", "approve", now)
	if err != nil || a.Status != ApprovalApproved {
		t.Fatalf("decide: %v %+v", err, a)
	}
	// Same decision again → idempotent echo, no error.
	a2, err := st.decide("a1", "approve", now)
	if err != nil || a2.Status != ApprovalApproved {
		t.Fatalf("repeat decide should be idempotent, got %v %+v", err, a2)
	}
	// Conflicting decision on a decided approval → rejected.
	if _, err := st.decide("a1", "reject", now); err == nil {
		t.Fatal("conflicting decision on decided approval should error")
	}
}

func TestApprovalDecideBadDecision(t *testing.T) {
	st := newApprovalStore()
	st.reduce(ev("approval_required", "a1"), time.UnixMilli(0))
	if _, err := st.decide("a1", "maybe", time.UnixMilli(0)); err != errApprovalBadDecision {
		t.Fatalf("expected bad-decision error, got %v", err)
	}
}
