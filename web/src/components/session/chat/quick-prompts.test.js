import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QUICK_PROMPTS,
  QUICK_PROMPTS_STORAGE_KEY,
  loadQuickPrompts,
  saveQuickPrompts,
} from './quick-prompts.js';

function storage(map = {}) {
  return {
    getItem: (k) => (k in map ? map[k] : null),
    setItem: (k, v) => {
      map[k] = v;
    },
  };
}

describe('quick-prompts', () => {
  it('returns default prompts when storage is empty', () => {
    expect(loadQuickPrompts({ storage: storage() })).toEqual(DEFAULT_QUICK_PROMPTS);
  });

  it('returns default prompts when storage is null', () => {
    expect(loadQuickPrompts({ storage: null })).toEqual(DEFAULT_QUICK_PROMPTS);
  });

  it('returns default prompts on malformed JSON', () => {
    const s = storage({ [QUICK_PROMPTS_STORAGE_KEY]: 'not json' });
    expect(loadQuickPrompts({ storage: s })).toEqual(DEFAULT_QUICK_PROMPTS);
  });

  it('returns default prompts when parsed value is not an array', () => {
    const s = storage({ [QUICK_PROMPTS_STORAGE_KEY]: '{"id":"x"}' });
    expect(loadQuickPrompts({ storage: s })).toEqual(DEFAULT_QUICK_PROMPTS);
  });

  it('filters out invalid entries and keeps valid ones', () => {
    const custom = [
      { id: 'a', label: 'A', prompt: 'do a' },
      { id: '', label: 'bad', prompt: 'no id' },
      { label: 'no id' },
      null,
      'string',
      { id: 'b', label: 'B', prompt: 'do b' },
    ];
    const s = storage({ [QUICK_PROMPTS_STORAGE_KEY]: JSON.stringify(custom) });
    expect(loadQuickPrompts({ storage: s })).toEqual([
      { id: 'a', label: 'A', prompt: 'do a' },
      { id: 'b', label: 'B', prompt: 'do b' },
    ]);
  });

  it('returns default prompts when all entries are invalid', () => {
    const s = storage({ [QUICK_PROMPTS_STORAGE_KEY]: '[null, "x", {}]' });
    expect(loadQuickPrompts({ storage: s })).toEqual(DEFAULT_QUICK_PROMPTS);
  });

  it('saves and loads custom prompts', () => {
    const s = storage();
    const prompts = [{ id: 'x', label: 'X', prompt: 'do x' }];
    saveQuickPrompts(prompts, { storage: s });
    expect(loadQuickPrompts({ storage: s })).toEqual(prompts);
  });

  it('handles storage setItem throwing', () => {
    const s = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(() => saveQuickPrompts([], { storage: s })).not.toThrow();
  });

  it('handles storage getItem throwing', () => {
    const s = {
      getItem: () => {
        throw new Error('denied');
      },
    };
    expect(loadQuickPrompts({ storage: s })).toEqual(DEFAULT_QUICK_PROMPTS);
  });
});
