// Quick Prompt definitions for the mobile chat composer. Frontend-only data —
// no backend storage. The list is loaded from localStorage so users can
// override it later (no edit UI yet); malformed entries fall back to the
// built-in defaults.

export const QUICK_PROMPTS_STORAGE_KEY = 'pi-web:v1:quick-prompts';

// Default prompts. Kept as data so a future settings UI can mutate the list.
// The prompt text is what gets inserted into the composer textarea.
export const DEFAULT_QUICK_PROMPTS = [
  { id: 'continue', label: '続けて', prompt: '続けて' },
  { id: 'test', label: 'テストして', prompt: 'テストして' },
  { id: 'diff', label: '差分を確認', prompt: '差分を確認' },
  { id: 'fix', label: '修正して', prompt: '修正して' },
  { id: 'commit', label: 'コミットして', prompt: 'コミットして' },
];

function isValidPrompt(item) {
  return (
    item &&
    typeof item === 'object' &&
    typeof item.id === 'string' &&
    item.id.length > 0 &&
    typeof item.label === 'string' &&
    item.label.length > 0 &&
    typeof item.prompt === 'string' &&
    item.prompt.length > 0
  );
}

export function loadQuickPrompts({ storage = globalThis.localStorage } = {}) {
  if (!storage) return DEFAULT_QUICK_PROMPTS;
  try {
    const raw = storage.getItem(QUICK_PROMPTS_STORAGE_KEY);
    if (raw === null || raw === undefined) return DEFAULT_QUICK_PROMPTS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_QUICK_PROMPTS;
    const valid = parsed.filter(isValidPrompt);
    return valid.length > 0 ? valid : DEFAULT_QUICK_PROMPTS;
  } catch {
    return DEFAULT_QUICK_PROMPTS;
  }
}

export function saveQuickPrompts(prompts, { storage = globalThis.localStorage } = {}) {
  if (!storage) return;
  try {
    storage.setItem(QUICK_PROMPTS_STORAGE_KEY, JSON.stringify(prompts));
  } catch {
    // Ignore storage failures.
  }
}
