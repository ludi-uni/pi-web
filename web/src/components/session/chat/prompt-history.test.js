import { describe, expect, it } from 'vitest';
import { promptHistory, extractUserText } from './prompt-history.js';

const user = (id, text, ts = '') => ({
  id,
  type: 'message',
  timestamp: ts,
  message: { role: 'user', content: [{ type: 'text', text }] },
});
const assistant = (id, text) => ({
  id,
  type: 'message',
  message: { role: 'assistant', content: [{ type: 'text', text }] },
});

describe('extractUserText', () => {
  it('handles string content', () => {
    expect(extractUserText('hello')).toBe('hello');
  });
  it('joins text blocks', () => {
    expect(
      extractUserText([
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b' },
      ]),
    ).toBe('a\nb');
  });
  it('ignores image blocks', () => {
    expect(
      extractUserText([
        { type: 'image', data: 'x' },
        { type: 'text', text: 'hi' },
      ]),
    ).toBe('hi');
  });
});

describe('promptHistory', () => {
  it('returns user prompts newest first', () => {
    const entries = [user('u1', 'first'), assistant('a1', 'r1'), user('u2', 'second')];
    const items = promptHistory(entries);
    expect(items.map((i) => i.text)).toEqual(['second', 'first']);
  });

  it('skips non-user and empty messages', () => {
    const entries = [assistant('a1', 'r'), user('u1', ''), user('u2', 'real')];
    expect(promptHistory(entries).map((i) => i.text)).toEqual(['real']);
  });

  it('truncates long previews', () => {
    const long = 'x'.repeat(200);
    const items = promptHistory([user('u1', long)]);
    expect(items[0].preview.length).toBeLessThanOrEqual(121);
    expect(items[0].preview.endsWith('…')).toBe(true);
    expect(items[0].text).toBe(long); // full text preserved
  });

  it('caps at the limit', () => {
    const entries = Array.from({ length: 60 }, (_, i) => user(`u${i}`, `p${i}`));
    expect(promptHistory(entries, { limit: 20 })).toHaveLength(20);
    expect(promptHistory(entries)).toHaveLength(50);
  });
});
