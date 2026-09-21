// Per-session composer draft autosave. Stored in localStorage keyed by
// session id so drafts never leak across sessions and survive reload / PWA
// restart. A size cap prevents a huge paste from filling storage.

const KEY_PREFIX = 'pi-web:draft:';
// ~200KB cap — well above any reasonable prompt, below localStorage pressure.
const MAX_DRAFT_BYTES = 200 * 1024;

export function draftKey(sessionId) {
  return KEY_PREFIX + sessionId;
}

export function loadDraft(sessionId, { storage = globalThis.localStorage } = {}) {
  if (!sessionId || !storage) return '';
  try {
    return storage.getItem(draftKey(sessionId)) || '';
  } catch {
    return '';
  }
}

export function saveDraft(sessionId, text, { storage = globalThis.localStorage } = {}) {
  if (!sessionId || !storage) return false;
  try {
    const value = String(text ?? '');
    if (!value) {
      storage.removeItem(draftKey(sessionId));
      return true;
    }
    if (value.length > MAX_DRAFT_BYTES) {
      // Truncate rather than drop the whole draft — the user keeps the head.
      storage.setItem(draftKey(sessionId), value.slice(0, MAX_DRAFT_BYTES));
      return true;
    }
    storage.setItem(draftKey(sessionId), value);
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(sessionId, { storage = globalThis.localStorage } = {}) {
  if (!sessionId || !storage) return;
  try {
    storage.removeItem(draftKey(sessionId));
  } catch {
    /* ignore */
  }
}

// setupDraftAutosave wires debounced save/restore on a textarea. Returns
// { clear } so the submit path can drop the draft after a successful send.
export function setupDraftAutosave({
  sessionId,
  textarea,
  storage = globalThis.localStorage,
  debounceMs = 400,
  windowImpl = globalThis.window,
} = {}) {
  if (!sessionId || !textarea || !storage) return { clear: () => {} };

  // Restore on mount (only when the field is empty — a restored draft shouldn't
  // clobber text the page already put there).
  if (!textarea.value) {
    const existing = loadDraft(sessionId, { storage });
    if (existing) {
      textarea.value = existing;
      textarea.dispatchEvent(new (windowImpl.Event || Event)('input', { bubbles: true }));
    }
  }

  let timer = null;
  const onInput = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      saveDraft(sessionId, textarea.value, { storage });
    }, debounceMs);
  };
  textarea.addEventListener('input', onInput);

  return {
    clear: () => {
      if (timer) clearTimeout(timer);
      timer = null;
      clearDraft(sessionId, { storage });
    },
    flush: () => {
      if (timer) clearTimeout(timer);
      timer = null;
      saveDraft(sessionId, textarea.value, { storage });
    },
    dispose: () => {
      textarea.removeEventListener('input', onInput);
      if (timer) clearTimeout(timer);
    },
  };
}
