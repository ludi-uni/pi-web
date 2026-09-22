import { describe, expect, it, vi } from 'vitest';
import { createCompanionRuntime } from './companion-runtime.js';
import { createCompanionStateMapper, TRANSIENT_MS } from './companion-states.js';

function fakeWindow() {
  let cbs = [];
  return {
    requestAnimationFrame: (cb) => {
      cbs.push(cb);
      return cbs.length;
    },
    cancelAnimationFrame: vi.fn(),
    _flush: (now) => {
      const q = cbs;
      cbs = [];
      q.forEach((cb) => cb(now));
    },
  };
}

function fakeRenderer() {
  return {
    states: [],
    setState(s) {
      this.states.push(s);
    },
    reducedMotion: vi.fn(),
    destroy: vi.fn(),
  };
}

// Controllable timers: a queue of {fn, at} the test drains manually.
function fakeTimers(start = 0) {
  let now = start;
  const queue = [];
  return {
    now: () => now,
    advance: (ms) => {
      now += ms;
      const due = queue.filter((t) => t.at <= now);
      for (const t of due) {
        queue.splice(queue.indexOf(t), 1);
        t.fn();
      }
    },
    setTimeoutImpl: (fn, ms) => {
      const t = { fn, at: now + ms };
      queue.push(t);
      return t;
    },
    clearTimeoutImpl: (t) => {
      const i = queue.indexOf(t);
      if (i >= 0) queue.splice(i, 1);
    },
    pending: () => queue.length,
  };
}

describe('companion-runtime', () => {
  it('emits flat Codex states to a non-companion renderer', () => {
    const win = fakeWindow();
    const timers = fakeTimers();
    const renderer = fakeRenderer();
    const mapper = createCompanionStateMapper({ now: timers.now });
    const rt = createCompanionRuntime({
      renderer,
      windowImpl: win,
      mapper,
      setTimeoutImpl: timers.setTimeoutImpl,
      clearTimeoutImpl: timers.clearTimeoutImpl,
    });
    rt.start();
    expect(renderer.states).toEqual(['idle']);
    rt.messageSent();
    expect(renderer.states.at(-1)).toBe('running');
    rt.workerState('idle');
    expect(renderer.states.at(-1)).toBe('completed');
    rt.destroy();
  });

  it('separates thinking from approval-waiting', () => {
    const win = fakeWindow();
    const timers = fakeTimers();
    const renderer = fakeRenderer();
    const rt = createCompanionRuntime({
      renderer,
      windowImpl: win,
      mapper: createCompanionStateMapper({ now: timers.now }),
      setTimeoutImpl: timers.setTimeoutImpl,
      clearTimeoutImpl: timers.clearTimeoutImpl,
    });
    rt.start();
    rt.messageSent();
    rt.chatPreview({ content: '<thought>hmm' });
    expect(renderer.states.at(-1)).toBe('running'); // thinking → running row
    rt.approvals([{ id: 'a' }]);
    expect(renderer.states.at(-1)).toBe('review'); // approval → review row
    rt.approvals([]);
    expect(renderer.states.at(-1)).toBe('running');
    rt.destroy();
  });

  it('completed transient auto-decays to idle', () => {
    const win = fakeWindow();
    const timers = fakeTimers();
    const renderer = fakeRenderer();
    const rt = createCompanionRuntime({
      renderer,
      windowImpl: win,
      mapper: createCompanionStateMapper({ now: timers.now }),
      setTimeoutImpl: timers.setTimeoutImpl,
      clearTimeoutImpl: timers.clearTimeoutImpl,
    });
    rt.start();
    rt.workerState('running');
    rt.workerState('idle');
    expect(renderer.states.at(-1)).toBe('completed');
    timers.advance(TRANSIENT_MS + 50);
    expect(renderer.states.at(-1)).toBe('idle');
    rt.destroy();
  });

  it('failed transient auto-decays to idle', () => {
    const win = fakeWindow();
    const timers = fakeTimers();
    const renderer = fakeRenderer();
    const rt = createCompanionRuntime({
      renderer,
      windowImpl: win,
      mapper: createCompanionStateMapper({ now: timers.now }),
      setTimeoutImpl: timers.setTimeoutImpl,
      clearTimeoutImpl: timers.clearTimeoutImpl,
    });
    rt.start();
    rt.failed();
    expect(renderer.states.at(-1)).toBe('failed');
    timers.advance(TRANSIENT_MS + 50);
    expect(renderer.states.at(-1)).toBe('idle');
    rt.destroy();
  });

  it('a new run during a transient wins and cancels the stale timer', () => {
    const win = fakeWindow();
    const timers = fakeTimers();
    const renderer = fakeRenderer();
    const rt = createCompanionRuntime({
      renderer,
      windowImpl: win,
      mapper: createCompanionStateMapper({ now: timers.now }),
      setTimeoutImpl: timers.setTimeoutImpl,
      clearTimeoutImpl: timers.clearTimeoutImpl,
    });
    rt.start();
    rt.workerState('running');
    rt.workerState('idle'); // completed transient armed
    rt.messageSent(); // new run — must clear the transient
    expect(renderer.states.at(-1)).toBe('running');
    // The stale transient timer fires later; it must NOT push idle over running.
    timers.advance(TRANSIENT_MS + 50);
    expect(renderer.states.at(-1)).toBe('running');
    rt.destroy();
  });

  it('stale timer for an older transient does not overwrite a newer one', () => {
    const win = fakeWindow();
    const timers = fakeTimers();
    const renderer = fakeRenderer();
    const rt = createCompanionRuntime({
      renderer,
      windowImpl: win,
      mapper: createCompanionStateMapper({ now: timers.now }),
      setTimeoutImpl: timers.setTimeoutImpl,
      clearTimeoutImpl: timers.clearTimeoutImpl,
    });
    rt.start();
    rt.workerState('running');
    rt.workerState('idle'); // pleased (gen1)
    rt.failed(); // concerned (gen2) — clears gen1's timer, arms gen2's
    expect(renderer.states.at(-1)).toBe('failed');
    timers.advance(TRANSIENT_MS + 50);
    expect(renderer.states.at(-1)).toBe('idle');
    rt.destroy();
  });

  it('forwards the full CompanionState to a companion-aware renderer', () => {
    const win = fakeWindow();
    const timers = fakeTimers();
    const renderer = { ...fakeRenderer(), acceptsCompanionState: true };
    const rt = createCompanionRuntime({
      renderer,
      windowImpl: win,
      mapper: createCompanionStateMapper({ now: timers.now }),
      setTimeoutImpl: timers.setTimeoutImpl,
      clearTimeoutImpl: timers.clearTimeoutImpl,
    });
    rt.start();
    rt.messageSent();
    expect(renderer.states.at(-1)).toEqual({
      activity: 'working',
      emotion: 'neutral',
      attention: 'task',
    });
    rt.destroy();
  });
});
