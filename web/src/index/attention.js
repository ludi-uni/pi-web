// Canonical attention model for the session Inbox. One module owns the mapping
// from a server attention row to a single per-session bucket so the grouping
// logic isn't duplicated across components.

export const ATTENTION_KINDS = {
  waiting: 'waiting_input',
  approval: 'approval_required',
  failed: 'failed',
  unread: 'completed_unread',
  running: 'running',
  none: 'none',
};

// Grouping order for the Inbox. Waiting/failed/approval are what the user must
// act on; unread is informational; running is context at the bottom.
export const INBOX_GROUPS = [
  { key: 'waiting', kinds: [ATTENTION_KINDS.waiting] },
  { key: 'approval', kinds: [ATTENTION_KINDS.approval] },
  { key: 'failed', kinds: [ATTENTION_KINDS.failed] },
  { key: 'unread', kinds: [ATTENTION_KINDS.unread] },
  { key: 'running', kinds: [ATTENTION_KINDS.running] },
];

// attentionKindFor maps one session's (running, attentionRow) pair to its
// bucket. Mirrors needsAttention() in internal/server/attention.go — keep the
// two in sync so the Inbox and any future badge agree. The server also sends a
// precomputed `kind` on each item; this is the fallback for map-only callers.
export function attentionKindFor(sessionId, { runningIds, attention } = {}) {
  const row = attention?.[sessionId];
  const running = runningIds?.has?.(sessionId) ?? false;
  if (row?.waiting) return ATTENTION_KINDS.waiting;
  if (row?.failed) return ATTENTION_KINDS.failed;
  if (running) return ATTENTION_KINDS.running;
  if (row?.completedAt && (!row.lastViewedAt || row.completedAt > row.lastViewedAt)) {
    return ATTENTION_KINDS.unread;
  }
  return ATTENTION_KINDS.none;
}

// buildInbox groups the server's self-contained attention items into the Inbox
// buckets. `items` comes from GET /api/attention — each element already carries
// name/project/lastActivity/kind, so no /api/sessions lookup is needed (and
// sessions older than the 100-item index window still appear). Returns
// { groups: [{key, sessions}], attentionCount }; running never counts toward
// attentionCount.
export function buildInbox(items, { runningIds, attention } = {}) {
  const buckets = new Map(INBOX_GROUPS.map((g) => [g.key, []]));
  let attentionCount = 0;
  for (const item of items || []) {
    // Prefer the server's kind; fall back to deriving it for map-only callers.
    const kind =
      item.kind && item.kind !== ATTENTION_KINDS.none
        ? item.kind
        : attentionKindFor(item.sessionId, { runningIds, attention });
    if (kind === ATTENTION_KINDS.none) continue;
    const group = INBOX_GROUPS.find((g) => g.kinds.includes(kind));
    if (!group) continue;
    // Normalize to the shape Inbox.svelte renders (id/name/project/lastActivity).
    buckets.get(group.key).push({
      id: item.sessionId,
      name: item.name || item.sessionId,
      project: item.project || '',
      lastActivity: item.lastActivity || item.completedAt || '',
    });
    if (kind !== ATTENTION_KINDS.running) attentionCount++;
  }
  const groups = INBOX_GROUPS.map((g) => ({ key: g.key, sessions: buckets.get(g.key) })).filter(
    (g) => g.sessions.length > 0,
  );
  return { groups, attentionCount };
}
