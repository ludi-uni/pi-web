import { describe, expect, it, vi } from 'vitest';
import { createPetRuntime } from './pet-runtime.js';
import { createPetStateMapper } from './pet-states.js';

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

describe('pet-runtime', () => {
  it('pushes state changes to the renderer', () => {
    const win = fakeWindow();
    const renderer = fakeRenderer();
    const rt = createPetRuntime({ renderer, windowImpl: win });
    rt.start();
    expect(renderer.states).toEqual(['idle']);
    rt.messageSent();
    expect(renderer.states).toEqual(['idle', 'running']);
    rt.workerState('idle');
    expect(renderer.states.at(-1)).toBe('completed');
    rt.destroy();
  });

  it('notifies listeners and dedupes unchanged states', () => {
    const win = fakeWindow();
    const rt = createPetRuntime({ renderer: fakeRenderer(), windowImpl: win });
    const seen = [];
    rt.onState((s) => seen.push(s));
    rt.start();
    rt.messageSent();
    rt.messageSent();
    expect(seen).toEqual(['idle', 'running']);
    rt.destroy();
  });

  it('tick loop advances time-based fallbacks', () => {
    let now = 0;
    const win = fakeWindow();
    const mapper = createPetStateMapper({ now: () => now });
    const renderer = fakeRenderer();
    const rt = createPetRuntime({ renderer, windowImpl: win, mapper });
    rt.start();
    rt.workerState('running');
    rt.workerState('idle');
    now += 5000;
    win._flush(now);
    expect(renderer.states.at(-1)).toBe('idle');
    rt.destroy();
  });
});
