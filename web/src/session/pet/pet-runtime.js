// pet-runtime.js — Phase 1 compatibility shim.
//
// createPetRuntime now delegates to createCompanionRuntime, which owns the rAF
// loop, transient timing, and renderer dispatch. The flat PetState surface is
// preserved: listeners and signal methods still see Codex-compatible states
// because the default CodexSpriteRenderer receives collapsed states.

import { createCompanionRuntime } from './companion-runtime.js';

export function createPetRuntime({ renderer, windowImpl, mapper } = {}) {
  return createCompanionRuntime({ renderer, windowImpl, mapper });
}
