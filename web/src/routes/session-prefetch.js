// In-memory prefetch cache for /api/session payloads, used by SessionCard hover
// to start the request before the route actually mounts. loadSessionPageState
// consumes the in-flight promise instead of issuing a fresh fetch when present.
//
// Bounded so a long-running SPA session can't accumulate stale entries; only
// holds Promises, never the resolved payload. Entries also expire after a short
// TTL: a prefetch started on hover can be arbitrarily stale by the time the
// user actually clicks (the session may have progressed in the meantime), so
// consumeSessionPrefetch drops entries older than PREFETCH_TTL_MS and lets the
// caller fall through to a fresh fetch.

const inflight = new Map();
const MAX_ENTRIES = 16;
const PREFETCH_TTL_MS = 10000;

export function prefetchSession(id, { fetchImpl = fetch, nowImpl = Date.now } = {}) {
  if (!id) return;
  const existing = inflight.get(id);
  if (existing && nowImpl() - existing.startedAt < PREFETCH_TTL_MS) return;
  if (inflight.size >= MAX_ENTRIES && !inflight.has(id)) {
    const oldest = inflight.keys().next().value;
    if (oldest) inflight.delete(oldest);
  }
  const promise = fetchImpl(`/api/session?id=${encodeURIComponent(id)}&paginate=1`, {
    headers: { Accept: 'application/json' },
  })
    .then((resp) => {
      if (!resp.ok) {
        inflight.delete(id);
        throw new Error(resp.status === 404 ? 'not found' : 'load failed');
      }
      return resp.json();
    })
    .catch((err) => {
      inflight.delete(id);
      throw err;
    });
  // Swallow uncaught-rejection warnings: consumeSessionPrefetch handlers add a
  // proper catcher when they read this back.
  promise.catch(() => {});
  inflight.set(id, { promise, startedAt: nowImpl() });
}

export function consumeSessionPrefetch(id, { nowImpl = Date.now } = {}) {
  if (!id) return null;
  const entry = inflight.get(id);
  if (!entry) return null;
  inflight.delete(id);
  // Expired prefetch: the payload may predate recent session activity, so the
  // caller falls through to a fresh /api/session fetch instead.
  if (nowImpl() - entry.startedAt >= PREFETCH_TTL_MS) return null;
  return entry.promise;
}

export function resetSessionPrefetch() {
  inflight.clear();
}
