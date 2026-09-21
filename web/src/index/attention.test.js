import { describe, expect, it } from 'vitest';
import { attentionKindFor, buildInbox, ATTENTION_KINDS } from './attention.js';

const item = (sessionId, extra = {}) => ({
  sessionId,
  name: sessionId,
  project: 'p',
  lastActivity: '',
  ...extra,
});

describe('attentionKindFor', () => {
  it('maps waiting flag to waiting_input', () => {
    expect(
      attentionKindFor('a', { runningIds: new Set(), attention: { a: { waiting: true } } }),
    ).toBe(ATTENTION_KINDS.waiting);
  });
  it('maps failed flag to failed', () => {
    expect(
      attentionKindFor('a', { runningIds: new Set(), attention: { a: { failed: true } } }),
    ).toBe(ATTENTION_KINDS.failed);
  });
  it('maps running (no flags) to running', () => {
    expect(attentionKindFor('a', { runningIds: new Set(['a']), attention: {} })).toBe(
      ATTENTION_KINDS.running,
    );
  });
  it('waiting wins over running', () => {
    expect(
      attentionKindFor('a', {
        runningIds: new Set(['a']),
        attention: { a: { waiting: true } },
      }),
    ).toBe(ATTENTION_KINDS.waiting);
  });
  it('maps completedAt > lastViewedAt to completed_unread', () => {
    expect(
      attentionKindFor('a', {
        runningIds: new Set(),
        attention: {
          a: { completedAt: '2026-09-21T10:00:00Z', lastViewedAt: '2026-09-21T09:00:00Z' },
        },
      }),
    ).toBe(ATTENTION_KINDS.unread);
  });
  it('maps completedAt <= lastViewedAt to none', () => {
    expect(
      attentionKindFor('a', {
        runningIds: new Set(),
        attention: {
          a: { completedAt: '2026-09-21T09:00:00Z', lastViewedAt: '2026-09-21T10:00:00Z' },
        },
      }),
    ).toBe(ATTENTION_KINDS.none);
  });
  it('maps no row / no running to none', () => {
    expect(attentionKindFor('a', { runningIds: new Set(), attention: {} })).toBe(
      ATTENTION_KINDS.none,
    );
    expect(attentionKindFor('a', {})).toBe(ATTENTION_KINDS.none);
  });
});

describe('buildInbox', () => {
  it('groups self-contained items by kind, running last', () => {
    const items = [
      item('w', { kind: 'waiting_input' }),
      item('f', { kind: 'failed' }),
      item('u', { kind: 'completed_unread' }),
      item('r', { kind: 'running' }),
      item('n', { kind: 'none' }),
    ];
    const { groups, attentionCount } = buildInbox(items);
    expect(groups.map((g) => g.key)).toEqual(['waiting', 'failed', 'unread', 'running']);
    expect(groups[0].sessions[0].id).toBe('w');
    expect(groups[3].sessions[0].id).toBe('r');
    expect(attentionCount).toBe(3); // running excluded
  });

  it('derives kind from the attention map when item.kind is absent', () => {
    const items = [item('w')];
    const { groups } = buildInbox(items, {
      runningIds: new Set(),
      attention: { w: { waiting: true } },
    });
    expect(groups[0].key).toBe('waiting');
  });

  it('returns empty when nothing needs attention', () => {
    const { groups, attentionCount } = buildInbox([item('a', { kind: 'none' })]);
    expect(groups).toEqual([]);
    expect(attentionCount).toBe(0);
  });

  it('surfaces sessions not in the /api/sessions window (metadata is inline)', () => {
    // An item for a session older than the 100-item index page still renders
    // because name/project/lastActivity come from the item itself.
    const items = [item('old.jsonl', { kind: 'failed', name: 'Old session', project: 'p' })];
    const { groups } = buildInbox(items);
    expect(groups[0].sessions[0].name).toBe('Old session');
  });
});
