/**
 * approval-model.js — state contract for a future approval flow.
 *
 * The backend emits NO approval events today. This module only defines the
 * shape the UI will consume once `approval_required` / `approval_resolved` /
 * `approval_rejected` events exist, plus a pure reducer so the contract is
 * testable now. Nothing here is wired into the live session page.
 *
 * Event contract (what a future backend will send over SSE / attention):
 *   approval_required  → { approval }  (see normalizeApproval)
 *   approval_resolved  → { approvalId, decision: 'approved' }
 *   approval_rejected  → { approvalId, decision: 'rejected' }
 *
 * The Inbox already reserves the 'approval_required' attention kind; when the
 * backend fires it, the existing attention pipeline maps it with no new state.
 */

/** Risk levels the backend may supply. Never AI-inferred — null when absent. */
export const APPROVAL_RISK = ['low', 'medium', 'high'];

/**
 * Normalize a raw approval payload into the UI contract. Unknown/missing
 * fields become null rather than guessed. `risk` is passed through verbatim —
 * it is never derived here.
 */
export function normalizeApproval(raw = {}) {
  return {
    id: raw.approval_id ?? raw.id ?? null,
    sessionId: raw.session_id ?? raw.sessionId ?? null,
    kind: raw.kind ?? null,
    title: raw.title ?? '',
    description: raw.description ?? '',
    requestedAction: raw.requested_action ?? raw.requestedAction ?? null,
    risk: APPROVAL_RISK.includes(raw.risk_level) ? raw.risk_level : null,
    createdAt: raw.created_at ?? raw.createdAt ?? null,
    status: 'pending',
  };
}

/**
 * Reduce an approval event into the pending-approvals map.
 * @param {Map} pending  Map<approvalId, approval>
 * @param {{type:string, approval?:object, approvalId?:string, decision?:string}} event
 * @returns {Map} a NEW map (immutable update for Svelte reactivity)
 */
export function reduceApprovalEvent(pending, event) {
  const next = new Map(pending);
  if (!event || !event.type) return next;
  switch (event.type) {
    case 'approval_required': {
      const a = normalizeApproval(event.approval);
      if (a.id) next.set(a.id, a);
      break;
    }
    case 'approval_resolved':
    case 'approval_rejected': {
      const id = event.approvalId ?? event.approval_id;
      const existing = next.get(id);
      if (existing) {
        next.set(id, {
          ...existing,
          status: event.type === 'approval_resolved' ? 'approved' : 'rejected',
        });
      }
      break;
    }
    default:
      break;
  }
  return next;
}

/** Pending (unresolved) approvals, oldest first. */
export function pendingApprovals(pending) {
  return [...pending.values()]
    .filter((a) => a.status === 'pending')
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
}
