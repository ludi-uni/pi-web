/**
 * approval-store.js — a tiny reactive store that holds pending approvals for
 * the open session and feeds ApprovalCard. It listens for `approval` SSE
 * events (the future pi→pi-web channel). Until pi emits them, the store stays
 * empty and ApprovalCard never renders in production — it only appears for
 * real `approval_required` events (or test events injected via dispatch()).
 */
import { normalizeApproval, reduceApprovalEvent, pendingApprovals } from './approval-model.js';

// The pending-approval map for the current session page. Module-level so the
// SSE listener (registered once) and the component share it. Svelte reads it
// through the getter function passed into ApprovalCard's host.
let pending = new Map();
const listeners = new Set();

function emit() {
  for (const fn of listeners) fn(pending);
}

/**
 * Apply an approval event (from SSE or a test). Returns the affected approval.
 * Unknown/malformed events are ignored.
 */
export function dispatchApprovalEvent(event) {
  pending = reduceApprovalEvent(pending, event);
  emit();
  return pending;
}

/** Current pending approvals for a session, oldest first. */
export function approvalsForSession(sessionId) {
  return pendingApprovals(pending).filter((a) => !sessionId || a.sessionId === sessionId);
}

/** Subscribe to store changes. Returns an unsubscribe function. */
export function subscribeApprovals(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Reset all state (session switch / test teardown). */
export function resetApprovals() {
  pending = new Map();
  emit();
}

/**
 * Seed the store from the server's pending-approval list for a session. Called
 * once when the session page mounts so an approval that fired before the SSE
 * listener attached is still shown. Each server approval is replayed as an
 * approval_required event through the normal reducer.
 */
export async function seedApprovals(sessionId, { getImpl } = {}) {
  if (!sessionId) return;
  try {
    const get = getImpl ?? ((u) => fetch(u).then((r) => r.json()));
    const res = await get(`/api/approvals?id=${encodeURIComponent(sessionId)}`);
    const list = Array.isArray(res?.approvals) ? res.approvals : [];
    // Reconcile, not just add: drop store entries for this session that are no
    // longer pending on the server (covers a missed resolved/rejected SSE).
    const serverIds = new Set(list.map((a) => a.id));
    const next = new Map(pending);
    for (const [id, a] of next) {
      if (a.sessionId === sessionId && a.status === 'pending' && !serverIds.has(id)) {
        next.set(id, { ...a, status: 'resolved' });
      }
    }
    pending = next;
    for (const a of list) {
      pending = reduceApprovalEvent(pending, {
        type: 'approval_required',
        approval: {
          approval_id: a.id,
          session_id: a.sessionId,
          kind: a.kind,
          title: a.title,
          description: a.description,
          requested_action: a.command,
          path: a.path,
          tool_name: a.toolName,
          risk_level: a.risk,
          created_at: a.createdAt,
          expires_at: a.expiresAt,
        },
      });
    }
    emit();
  } catch {
    /* seeding is best-effort; SSE still covers live events */
  }
}

/**
 * Parse an SSE `approval` event payload and dispatch it. Wire format matches
 * the Go approvalEvent (snake_case fields). Returns true when handled.
 */
export function handleApprovalSSE(data) {
  if (!data || typeof data !== 'object') return false;
  dispatchApprovalEvent({
    type: data.type,
    approval: data.approval ?? {
      approval_id: data.approval_id,
      session_id: data.session_id,
      // normalizeApproval reads `kind`; the wire uses `action_kind`.
      kind: data.action_kind ?? data.kind,
      title: data.title,
      description: data.description,
      requested_action: data.command ?? data.requested_action,
      path: data.path,
      tool_name: data.tool_name,
      risk_level: data.risk_level,
      created_at: data.created_at,
      expires_at: data.expires_at,
    },
    approvalId: data.approval_id,
    decision: data.decision,
  });
  return true;
}

export const __test__ = { normalizeApproval };

// Test seam: expose the dispatch handle on window so Playwright can inject a
// fixture approval event end-to-end (there is no real producer yet). Guarded
// to a browser window; harmless in production since nothing emits events.
if (typeof window !== 'undefined') {
  window.__approvalStore = {
    dispatchApprovalEvent,
    resetApprovals,
    pendingCount: () => pendingApprovals(pending).length,
  };
}
