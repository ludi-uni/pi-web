import { describe, expect, it } from 'vitest';
import {
  createCompanionStateMapper,
  companionToPetState,
  TRANSIENT_MS,
} from './companion-states.js';

function make() {
  let now = 1000;
  const mapper = createCompanionStateMapper({ now: () => now });
  return { mapper, advance: (ms) => (now += ms), now: () => now };
}

describe('companion-states mapper (3-axis)', () => {
  it('starts idle/neutral/none', () => {
    const { mapper } = make();
    expect(mapper.state()).toEqual({ activity: 'idle', emotion: 'neutral', attention: 'none' });
  });

  it('message sent → working/task', () => {
    const { mapper } = make();
    expect(mapper.noteMessageSent()).toEqual({
      activity: 'working',
      emotion: 'neutral',
      attention: 'task',
    });
  });

  it('thinking preview while running → thinking (distinct from approval)', () => {
    const { mapper } = make();
    mapper.noteWorkerState('running');
    expect(mapper.noteChatPreview({ content: '<thought>reasoning' })).toEqual({
      activity: 'thinking',
      emotion: 'neutral',
      attention: 'task',
    });
    // thinking and approval are separate: no approval pending here.
    expect(mapper.state().activity).toBe('thinking');
  });

  it('approval_required → waiting/user (distinct from thinking)', () => {
    const { mapper } = make();
    mapper.noteWorkerState('running');
    mapper.noteChatPreview({ content: '<thought>reasoning' });
    expect(mapper.noteApprovals([{ id: 'a' }])).toEqual({
      activity: 'waiting',
      emotion: 'neutral',
      attention: 'user',
    });
    // Resolve → back to thinking/working, not stuck in waiting.
    expect(mapper.noteApprovals([])).toEqual({
      activity: 'thinking',
      emotion: 'neutral',
      attention: 'task',
    });
  });

  it('worker error → idle/concerned/task', () => {
    const { mapper } = make();
    mapper.noteWorkerState('running');
    expect(mapper.noteWorkerState('error')).toEqual({
      activity: 'idle',
      emotion: 'concerned',
      attention: 'task',
    });
  });

  it('normal completion → pleased transient → neutral idle', () => {
    const { mapper, advance } = make();
    mapper.noteWorkerState('running');
    expect(mapper.noteWorkerState('idle')).toEqual({
      activity: 'idle',
      emotion: 'pleased',
      attention: 'user',
    });
    advance(TRANSIENT_MS + 1);
    expect(mapper.tick()).toEqual({ activity: 'idle', emotion: 'neutral', attention: 'none' });
  });

  it('waiting attention after idle → waiting/user (supersedes the celebration)', () => {
    const { mapper } = make();
    mapper.noteWorkerState('running');
    mapper.noteWorkerState('idle');
    expect(mapper.noteAttention({ waiting: true })).toEqual({
      activity: 'waiting',
      emotion: 'neutral', // pleased was superseded by the waiting verdict
      attention: 'user',
    });
  });

  it('failed attention → concerned', () => {
    const { mapper } = make();
    mapper.noteWorkerState('running');
    mapper.noteWorkerState('idle');
    expect(mapper.noteAttention({ failed: true })).toEqual({
      activity: 'idle',
      emotion: 'concerned',
      attention: 'task',
    });
  });

  it('new run supersedes a transient (running wins over pleased)', () => {
    const { mapper } = make();
    mapper.noteWorkerState('running');
    mapper.noteWorkerState('idle'); // pleased transient armed
    expect(mapper.noteMessageSent()).toEqual({
      activity: 'working',
      emotion: 'neutral',
      attention: 'task',
    });
  });

  it('stale timer generation cannot overwrite a newer transient', () => {
    const { mapper, advance } = make();
    mapper.noteWorkerState('running');
    mapper.noteWorkerState('idle'); // pleased, gen=1
    const gen1 = mapper.transientGeneration();
    advance(10);
    mapper.noteFailed(); // concerned, gen=2 re-arms
    // A stale tick armed for gen1 must not clear the gen2 transient even
    // after gen1's original expiry has passed (t=1010+TRANSIENT_MS).
    advance(TRANSIENT_MS - 1); // now = 5009 > gen1.until(5000), < gen2.until(5010)
    expect(mapper.tick(gen1).emotion).toBe('concerned');
    // gen2's own expiry still applies (gen2 armed at t=1010).
    advance(20); // now = 5031 > gen2.until
    expect(mapper.tick().emotion).toBe('neutral');
  });
});

describe('companionToPetState (Codex compat collapse)', () => {
  const cases = [
    [{ activity: 'idle', emotion: 'neutral', attention: 'none' }, 'idle'],
    [{ activity: 'thinking', emotion: 'neutral', attention: 'task' }, 'running'],
    [{ activity: 'working', emotion: 'neutral', attention: 'task' }, 'running'],
    [{ activity: 'waiting', emotion: 'neutral', attention: 'user' }, 'review'],
    [{ activity: 'waiting', emotion: 'neutral', attention: 'task' }, 'waiting'],
    [{ activity: 'idle', emotion: 'concerned', attention: 'task' }, 'failed'],
    [{ activity: 'idle', emotion: 'pleased', attention: 'user' }, 'completed'],
  ];
  for (const [input, want] of cases) {
    it(`${input.activity}/${input.emotion}/${input.attention} → ${want}`, () => {
      expect(companionToPetState(input)).toBe(want);
    });
  }
});
