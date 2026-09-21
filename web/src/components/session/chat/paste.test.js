import { describe, expect, it } from 'vitest';
import { isLargePaste, LARGE_PASTE_BYTES } from './paste.js';

describe('isLargePaste', () => {
  it('flags text at/over the threshold', () => {
    expect(isLargePaste('x'.repeat(LARGE_PASTE_BYTES))).toBe(true);
    expect(isLargePaste('x'.repeat(LARGE_PASTE_BYTES + 1))).toBe(true);
  });
  it('passes smaller text', () => {
    expect(isLargePaste('x'.repeat(LARGE_PASTE_BYTES - 1))).toBe(false);
    expect(isLargePaste('short')).toBe(false);
  });
  it('handles non-strings', () => {
    expect(isLargePaste('')).toBe(false);
    expect(isLargePaste(null)).toBe(false);
    expect(isLargePaste(undefined)).toBe(false);
  });
});
