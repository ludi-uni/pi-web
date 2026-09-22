// CompanionRuntime — Phase 2 runtime. Feeds pi-web signals into the
// CompanionStateMapper and drives a renderer adapter. Owns ALL state
// transitions and transient-emotion timing; renderers stay dumb.
//
// Renderer adapter contract (unchanged from Phase 1's PetRenderer):
//   load(pkg)          → Promise<void> — pkg: {id, manifestUrl, imageUrl, fio?}
//   setState(state)    — flat Codex state OR CompanionState (adapter decides)
//   attach(el) / destroy() / reducedMotion(b) / setScale(n) / frameSize()
//
// A renderer that only understands flat Codex states (CodexSpriteRenderer)
// receives the collapsed PetState via companionToPetState(). A future
// Cast2D/Live2D renderer can declare `acceptsCompanionState = true` to receive
// the full 3-axis CompanionState instead.

import { createCompanionStateMapper, companionToPetState } from './companion-states.js';

export function createCompanionRuntime({
  renderer,
  windowImpl = typeof window !== 'undefined' ? window : null,
  mapper = createCompanionStateMapper(),
  setTimeoutImpl = (typeof window !== 'undefined' ? window : globalThis)?.setTimeout?.bind(
    typeof window !== 'undefined' ? window : globalThis,
  ),
  clearTimeoutImpl = (typeof window !== 'undefined' ? window : globalThis)?.clearTimeout?.bind(
    typeof window !== 'undefined' ? window : globalThis,
  ),
} = {}) {
  let raf = 0;
  let destroyed = false;
  let transientTimer = null;
  const listeners = new Set();
  const acceptsCompanion = renderer?.acceptsCompanionState === true;
  let companion = mapper.state();
  let emitted = null; // last value sent to the renderer

  function toRendererState(c) {
    return acceptsCompanion ? c : companionToPetState(c);
  }

  function same(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    return a.activity === b.activity && a.emotion === b.emotion && a.attention === b.attention;
  }

  function push() {
    const next = toRendererState(companion);
    if (same(next, emitted)) return;
    emitted = next;
    renderer?.setState?.(next);
    for (const fn of listeners) fn(next, companion);
  }

  function clearTransientTimer() {
    if (transientTimer && clearTimeoutImpl) clearTimeoutImpl(transientTimer);
    transientTimer = null;
  }

  // Arm the decay for the mapper's current transient. The generation guard
  // (checked inside mapper.tick) makes a stale timer a no-op, so a new signal
  // that re-arms or clears the transient can never be overwritten by an older
  // timer firing late.
  function armTransientTimer() {
    clearTransientTimer();
    const gen = mapper.transientGeneration?.();
    const until = mapper.transientUntil?.();
    if (!gen || !until || !setTimeoutImpl) return;
    const delay = Math.max(0, until - Date.now()) + 20;
    transientTimer = setTimeoutImpl(() => {
      transientTimer = null;
      companion = mapper.tick(gen);
      push();
    }, delay);
  }

  function update(next) {
    companion = next;
    push();
    armTransientTimer();
    return emitted;
  }

  function loop() {
    if (destroyed) return;
    update(mapper.tick());
    raf = windowImpl?.requestAnimationFrame?.(loop) ?? 0;
  }

  return {
    start() {
      if (destroyed || !windowImpl?.requestAnimationFrame) return;
      companion = mapper.state();
      emitted = null;
      push();
      raf = windowImpl.requestAnimationFrame(loop);
    },
    stop() {
      if (raf && windowImpl?.cancelAnimationFrame) windowImpl.cancelAnimationFrame(raf);
      raf = 0;
      clearTransientTimer();
    },
    destroy() {
      destroyed = true;
      this.stop();
      renderer?.destroy?.();
      listeners.clear();
    },
    // Signal entry points — each returns the flat renderer-visible state.
    messageSent: () => update(mapper.noteMessageSent()),
    chatPreview: (p) => update(mapper.noteChatPreview(p)),
    approvals: (list) => update(mapper.noteApprovals(list)),
    workerState: (s) => update(mapper.noteWorkerState(s)),
    attention: (a) => update(mapper.noteAttention(a)),
    failed: () => update(mapper.noteFailed()),
    state: () => emitted,
    companionState: () => companion,
    onState(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    setReducedMotion(flag) {
      renderer?.reducedMotion?.(!!flag);
    },
  };
}
