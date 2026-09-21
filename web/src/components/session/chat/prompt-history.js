// Prompt history: the user's own sent prompts for one session, newest first.
// Source is the session's message entries (already loaded into the model) — no
// separate store. Used by the history popover to reload a past prompt into the
// composer for editing + resend (never auto-sends).

const MAX_HISTORY = 50;
const PREVIEW_LEN = 120;

// extractText pulls the plain text out of a user message's content (string or
// content-block array). Image-only messages return ''.
export function extractUserText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');
}

// promptHistory returns up to `limit` user prompts, newest first. Each item is
// { id, text, preview, timestamp }. `preview` is the first line, truncated.
export function promptHistory(entries = [], { limit = MAX_HISTORY } = {}) {
  const out = [];
  // Walk newest → oldest so the most recent prompts come first.
  for (let i = entries.length - 1; i >= 0 && out.length < limit; i--) {
    const entry = entries[i];
    if (entry?.type !== 'message') continue;
    const msg = entry.message;
    if (!msg || msg.role !== 'user') continue;
    const text = extractUserText(msg.content).trim();
    if (!text) continue;
    const firstLine = text.split('\n')[0];
    out.push({
      id: entry.id || `p${i}`,
      text,
      preview: firstLine.length > PREVIEW_LEN ? firstLine.slice(0, PREVIEW_LEN) + '…' : firstLine,
      timestamp: entry.timestamp || msg.timestamp || '',
    });
  }
  return out;
}
