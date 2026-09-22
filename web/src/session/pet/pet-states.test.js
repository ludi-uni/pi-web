import { describe, expect, it } from 'vitest';
import {
  createPetStateMapper,
  STATE_TO_ROW,
  PET_STATES,
  CODEX_ROW_FOR_STATE,
} from './pet-states.js';
import { TRANSIENT_MS } from './companion-states.js';

function make() {
  let now = 1000;
  const mapper = createPetStateMapper({ now: () => now });
  return { mapper, advance: (ms) => (now += ms) };
}

describe('pet-states mapper (Phase 1 compat)', () => {
  it('starts idle', () => {
    const { mapper } = make();
    expect(mapper.state()).toBe('idle');
  });

  it('message sent → running', () => {
    const { mapper } = make();
    expect(mapper.noteMessageSent()).toBe('running');
  });

  it('worker running → running', () => {
    const { mapper } = make();
    expect(mapper.noteWorkerState('running')).toBe('running');
  });

  // Phase 2 change: thinking now collapses to `running`, not `review`. Only
  // user-attention waits (approval / ask) map to review.
  it('thinking preview while running → running (not review)', () => {
    const { mapper } = make();
    mapper.noteWorkerState('running');
    expect(mapper.noteChatPreview({ content: '<thought>hmm' })).toBe('running');
    expect(mapper.noteChatPreview({ content: '<thought>hmm</thought>answer' })).toBe('running');
  });

  it('pending approval → review (wins over running)', () => {
    const { mapper } = make();
    mapper.noteWorkerState('running');
    expect(mapper.noteApprovals([{ id: 'a' }])).toBe('review');
    expect(mapper.noteApprovals([])).toBe('running');
  });

  it('worker error → failed', () => {
    const { mapper } = make();
    mapper.noteWorkerState('running');
    expect(mapper.noteWorkerState('error')).toBe('failed');
  });

  it('running → idle gives a brief completed then idle', () => {
    const { mapper, advance } = make();
    mapper.noteWorkerState('running');
    expect(mapper.noteWorkerState('idle')).toBe('completed');
    advance(TRANSIENT_MS + 1);
    expect(mapper.tick()).toBe('idle');
  });

  // Phase 2 collapse: waiting+attention:user flattens to `review` (the Codex
  // "needs the user" row). The flat `waiting` row is reserved for non-user
  // waits; the compat layer maps both to review so the pet still reads as
  // "waiting on you".
  it('waiting attention after idle → review (supersedes completed)', () => {
    const { mapper } = make();
    mapper.noteWorkerState('running');
    mapper.noteWorkerState('idle');
    expect(mapper.noteAttention({ waiting: true })).toBe('review');
  });

  it('failed attention → failed', () => {
    const { mapper } = make();
    mapper.noteWorkerState('running');
    mapper.noteWorkerState('idle');
    expect(mapper.noteAttention({ failed: true })).toBe('failed');
  });

  it('new prompt clears waiting/failed', () => {
    const { mapper } = make();
    mapper.noteAttention({ waiting: true, failed: true });
    expect(mapper.noteMessageSent()).toBe('running');
  });

  it('maps every canonical state to a Codex row', () => {
    for (const s of PET_STATES) {
      expect(STATE_TO_ROW[s]).toBeTypeOf('number');
    }
    expect(STATE_TO_ROW.completed).toBe(4); // jumping row
    expect(STATE_TO_ROW.running).toBe(7);
    expect(STATE_TO_ROW.review).toBe(8);
    expect(CODEX_ROW_FOR_STATE['running-right']).toBe(1);
  });
});
