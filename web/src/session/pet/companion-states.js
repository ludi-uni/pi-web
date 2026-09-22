// CompanionStateMapper — Phase 2 state model. Replaces the flat PetState with
// a 3-axis companion state so renderers can distinguish nuances the Codex
// sprite rows collapse (e.g. thinking vs. approval wait).
//
//   activity:  idle | thinking | working | waiting
//   emotion:   neutral | pleased | concerned
//   attention: none | task | user
//
// Transient emotions (pleased after a normal completion, concerned after a
// failure) auto-decay to neutral after TRANSIENT_MS. A new run or a fresh
// signal supersedes a pending transient — the mapper carries a generation
// counter so a stale timer can never overwrite a newer state.

export const COMPANION_ACTIVITIES = ['idle', 'thinking', 'working', 'waiting'];
export const COMPANION_EMOTIONS = ['neutral', 'pleased', 'concerned'];
export const COMPANION_ATTENTION = ['none', 'task', 'user'];

// How long pleased/concerned stay before decaying back to neutral (ms).
export const TRANSIENT_MS = 4000;

export function createCompanionStateMapper({ now = () => Date.now() } = {}) {
  // Persistent signals.
  let running = false;
  let workerError = false;
  let thinking = false;
  let pendingApproval = false;
  let attentionWaiting = false;
  let attentionFailed = false;

  // Transient emotion: {emotion, until, generation}.
  let transient = null;
  let generation = 0;

  function current() {
    const t = now();
    const emotion = transient && t < transient.until ? transient.emotion : 'neutral';

    // Attention flags outrank the transient celebration: a session that
    // finished waiting/failed should read waiting/concerned, not pleased.
    if (pendingApproval) {
      return { activity: 'waiting', emotion, attention: 'user' };
    }
    if (workerError) {
      return { activity: 'idle', emotion: 'concerned', attention: 'task' };
    }
    if (running) {
      return {
        activity: thinking ? 'thinking' : 'working',
        emotion,
        attention: 'task',
      };
    }
    if (attentionWaiting) {
      return { activity: 'waiting', emotion, attention: 'user' };
    }
    if (attentionFailed) {
      return { activity: 'idle', emotion: 'concerned', attention: 'task' };
    }
    if (emotion !== 'neutral') {
      // A concerned reaction reads as a task problem; pleased reads as the
      // user-facing "done" celebration.
      return { activity: 'idle', emotion, attention: emotion === 'pleased' ? 'user' : 'task' };
    }
    return { activity: 'idle', emotion: 'neutral', attention: 'none' };
  }

  // beginTransient arms an emotion decay and returns its generation so the
  // runtime can schedule the expiry tick without a stale timer overwriting a
  // newer state.
  function beginTransient(emotion) {
    generation += 1;
    transient = { emotion, until: now() + TRANSIENT_MS, generation };
    return transient.generation;
  }

  return {
    noteMessageSent() {
      running = true;
      workerError = false;
      thinking = false;
      attentionWaiting = false;
      attentionFailed = false;
      transient = null;
      return current();
    },
    noteChatPreview(payload) {
      if (!payload || typeof payload !== 'object') return current();
      const content = typeof payload.content === 'string' ? payload.content : '';
      const openThought = content.lastIndexOf('<thought>');
      const closeThought = content.lastIndexOf('</thought>');
      thinking = openThought > closeThought;
      if (payload.done) thinking = false;
      return current();
    },
    noteApprovals(list) {
      pendingApproval = Array.isArray(list) && list.length > 0;
      return current();
    },
    noteWorkerState(state) {
      if (state === 'running') {
        running = true;
        workerError = false;
        attentionWaiting = false;
        attentionFailed = false;
        transient = null;
      } else if (state === 'error') {
        running = false;
        workerError = true;
      } else if (state === 'idle') {
        const wasRunning = running;
        running = false;
        workerError = false;
        thinking = false;
        if (wasRunning) {
          // The attention row lands after the idle transition, so arm the
          // celebration unconditionally; noteAttention will supersede it if
          // the session actually needs the user.
          beginTransient('pleased');
        }
      }
      return current();
    },
    noteAttention({ waiting = false, failed = false, approval = false } = {}) {
      attentionWaiting = !!waiting;
      attentionFailed = !!failed;
      if (approval) pendingApproval = true;
      // A waiting/failed verdict supersedes the completion celebration.
      if ((waiting || failed || approval) && transient?.emotion === 'pleased') {
        transient = null;
      }
      if (failed) beginTransient('concerned');
      return current();
    },
    noteFailed() {
      beginTransient('concerned');
      return current();
    },
    // tick(now) decays an expired transient. The optional generation guard
    // means a timer armed for an older transient is a no-op against a newer
    // one — it can never resurrect a stale emotion.
    tick(gen) {
      // The generation guard is the ONLY expiry check when one is supplied:
      // a stale timer (gen ≠ current generation) is a pure no-op and must
      // never clear or shorten the live transient, even if its own original
      // deadline has already passed. An unguarded tick (the rAF loop) decays
      // by wall-clock.
      if (gen != null) {
        if (!transient || gen !== transient.generation) return current();
        if (now() < transient.until) return current();
        transient = null;
        return current();
      }
      if (transient && now() >= transient.until) {
        transient = null;
      }
      return current();
    },
    // test/debug seam
    _transient: () => transient,
    transientGeneration() {
      return transient ? transient.generation : 0;
    },
    transientUntil() {
      return transient ? transient.until : 0;
    },
    state: current,
  };
}

// ── Codex compatibility layer ────────────────────────────────────────────────
// Collapses a CompanionState onto the flat PetState vocabulary so the Codex
// sprite renderer keeps working unchanged. thinking and approval both used to
// squeeze into `review`; now only user-attention waits map there.
export function companionToPetState(c) {
  if (!c || typeof c !== 'object') return 'idle';
  const { activity, emotion, attention } = c;
  if (emotion === 'concerned') return 'failed';
  if (emotion === 'pleased') return 'completed';
  if (activity === 'waiting' && attention === 'user') return 'review';
  if (activity === 'waiting') return 'waiting';
  if (activity === 'thinking' || activity === 'working') return 'running';
  return 'idle';
}

// Back-compat: the flat Codex states this runtime can emit.
export const PET_STATES = ['idle', 'running', 'waiting', 'review', 'failed', 'completed'];

// Flat PetState -> Codex spritesheet row index (8-col atlas).
export const STATE_TO_ROW = {
  idle: 0,
  running: 7,
  waiting: 6,
  review: 8,
  failed: 5,
  completed: 4, // jumping
};
