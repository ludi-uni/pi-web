import { afterEach, describe, expect, it } from 'vitest';
import {
  consumeSessionPrefetch,
  prefetchSession,
  resetSessionPrefetch,
} from './session-prefetch.js';

afterEach(() => resetSessionPrefetch());

describe('session-prefetch', () => {
  it('starts an /api/session fetch and lets consume await the same promise', async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      return { ok: true, json: async () => ({ name: 'Prefetched' }) };
    };

    prefetchSession('s.jsonl', { fetchImpl });
    const data = await consumeSessionPrefetch('s.jsonl');

    expect(calls).toEqual(['/api/session?id=s.jsonl&paginate=1']);
    expect(data).toEqual({ name: 'Prefetched' });
  });

  it('dedupes concurrent prefetches for the same id', () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return { ok: true, json: async () => ({}) };
    };
    prefetchSession('s.jsonl', { fetchImpl });
    prefetchSession('s.jsonl', { fetchImpl });
    expect(calls).toBe(1);
  });

  it('removes the entry once consumed so the next call goes back to the network', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return { ok: true, json: async () => ({}) };
    };
    prefetchSession('s.jsonl', { fetchImpl });
    await consumeSessionPrefetch('s.jsonl');
    expect(consumeSessionPrefetch('s.jsonl')).toBe(null);
    expect(calls).toBe(1);
  });

  it('returns null when there is no prefetch for the id', () => {
    expect(consumeSessionPrefetch('nope')).toBe(null);
  });

  it('drops a rejected prefetch so callers fall back to a fresh fetch', async () => {
    const fetchImpl = async () => ({ ok: false, status: 500 });
    prefetchSession('s.jsonl', { fetchImpl });
    const promise = consumeSessionPrefetch('s.jsonl');
    expect(promise).not.toBe(null);
    await expect(promise).rejects.toThrow();
    // Entry was already removed when consumed; another consume returns null.
    expect(consumeSessionPrefetch('s.jsonl')).toBe(null);
  });

  it('expires stale prefetches so a hover-then-delayed-click refetches', async () => {
    let now = 1000;
    const nowImpl = () => now;
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return { ok: true, json: async () => ({ name: `v${calls}` }) };
    };

    prefetchSession('s.jsonl', { fetchImpl, nowImpl });
    // 20s later the session may have progressed — the cached promise is dropped.
    now += 20000;
    expect(consumeSessionPrefetch('s.jsonl', { nowImpl })).toBe(null);

    // A fresh prefetch after expiry starts a new request.
    prefetchSession('s.jsonl', { fetchImpl, nowImpl });
    expect(calls).toBe(2);
    const data = await consumeSessionPrefetch('s.jsonl', { nowImpl });
    expect(data).toEqual({ name: 'v2' });
  });

  it('does not dedupe a prefetch that is already past the TTL', () => {
    let now = 0;
    const nowImpl = () => now;
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return { ok: true, json: async () => ({}) };
    };
    prefetchSession('s.jsonl', { fetchImpl, nowImpl });
    now += 15000;
    prefetchSession('s.jsonl', { fetchImpl, nowImpl });
    expect(calls).toBe(2);
  });
});
