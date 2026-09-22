// pet-states.js — Phase 1 compatibility shim.
//
// The flat PetState vocabulary and the Codex row mapping moved to
// companion-states.js in Phase 2. This module re-exports them and keeps the
// original createPetStateMapper working for any legacy caller; new code should
// use createCompanionStateMapper + createCompanionRuntime instead.

import {
  createCompanionStateMapper,
  companionToPetState,
  PET_STATES,
  STATE_TO_ROW,
} from './companion-states.js';

export { PET_STATES, STATE_TO_ROW };

// Re-export under the old name too: Phase 1 documented this table.
export const CODEX_ROW_FOR_STATE = {
  idle: 0,
  'running-right': 1,
  'running-left': 2,
  waving: 3,
  jumping: 4,
  failed: 5,
  waiting: 6,
  running: 7,
  review: 8,
};

// Legacy durations, kept for callers that imported them.
export const COMPLETED_MS = 2600;
export const FAILED_MS = 5000;

/**
 * Legacy flat-state mapper. Same signal surface as Phase 1; internally wraps
 * the companion mapper and collapses to flat PetStates. Prefer the companion
 * mapper for new work.
 */
export function createPetStateMapper(opts = {}) {
  const companion = createCompanionStateMapper(opts);
  const wrap =
    (fn) =>
    (...args) =>
      companionToPetState(fn(...args));
  return {
    noteMessageSent: wrap(companion.noteMessageSent),
    noteChatPreview: wrap(companion.noteChatPreview),
    noteApprovals: wrap(companion.noteApprovals),
    noteWorkerState: wrap(companion.noteWorkerState),
    noteAttention: wrap(companion.noteAttention),
    noteFailed: wrap(companion.noteFailed),
    tick: wrap(companion.tick),
    state: () => companionToPetState(companion.state()),
  };
}
