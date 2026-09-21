import { describe, expect, it, beforeEach } from 'vitest';
import { loadDraft, saveDraft, clearDraft, draftKey } from './draft-store.js';

function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _map: m,
  };
}

describe('draft-store', () => {
  let storage;
  beforeEach(() => {
    storage = memStorage();
  });

  it('saves and loads a draft per session', () => {
    saveDraft('a.jsonl', 'draft a', { storage });
    saveDraft('b.jsonl', 'draft b', { storage });
    expect(loadDraft('a.jsonl', { storage })).toBe('draft a');
    expect(loadDraft('b.jsonl', { storage })).toBe('draft b');
  });

  it('clear removes only that session', () => {
    saveDraft('a.jsonl', 'a', { storage });
    saveDraft('b.jsonl', 'b', { storage });
    clearDraft('a.jsonl', { storage });
    expect(loadDraft('a.jsonl', { storage })).toBe('');
    expect(loadDraft('b.jsonl', { storage })).toBe('b');
  });

  it('empty text removes the key', () => {
    saveDraft('a.jsonl', 'x', { storage });
    saveDraft('a.jsonl', '', { storage });
    expect(storage._map.has(draftKey('a.jsonl'))).toBe(false);
  });

  it('truncates drafts over the cap', () => {
    const big = 'x'.repeat(300 * 1024);
    saveDraft('a.jsonl', big, { storage });
    const loaded = loadDraft('a.jsonl', { storage });
    expect(loaded.length).toBe(200 * 1024);
  });

  it('returns empty for missing session id', () => {
    expect(loadDraft('', { storage })).toBe('');
    expect(loadDraft(null, { storage })).toBe('');
  });
});
