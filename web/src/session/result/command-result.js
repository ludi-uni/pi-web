/**
 * command-result.js — structured model of "what ran and how it ended" for the
 * Result Card's Tests/Build/Checks section and the Execution summary drawer.
 *
 * Only structured signals are used: bashExecution.exitCode / cancelled, and
 * toolCall→toolResult pairing with isError + the explicit "Command exited with
 * code N" suffix pi appends to failed bash output. No assistant prose is parsed.
 *
 * CommandResult shape:
 *   id, command, category, exitCode, succeeded, failed, cancelled,
 *   startedAt, durationMs, outputSummary, source
 *   source: 'bash_execution' | 'tool_result' | 'unknown'
 */

export const COMMAND_CATEGORIES = ['test', 'build', 'lint', 'format', 'typecheck', 'git', 'other'];

// Explicit, limited classification rules. Only unambiguous command prefixes/
// tokens map to a category; anything else is 'other'. No fuzzy inference.
const CATEGORY_RULES = [
  { category: 'test', re: /\b(go test|npm test|npm run test|vitest|jest|pytest|cargo test|go vet|playwright test)\b/ },
  { category: 'build', re: /\b(go build|npm run build|vite build|cargo build|make build|tsc\b|webpack|go install)\b/ },
  { category: 'lint', re: /\b(npm run lint|eslint|golangci-lint|clippy|cargo clippy|ruff|flake8|npm run format:check)\b/ },
  { category: 'format', re: /\b(prettier|gofmt|rustfmt|cargo fmt|black|npm run format\b)\b/ },
  { category: 'typecheck', re: /\b(tsc --noEmit|tsc -b|mypy|pyright|svelte-check|vue-tsc)\b/ },
  { category: 'git', re: /^\s*git\s+(status|diff|log|show|rev-parse|ls-files|branch|fetch|remote)\b/ },
];

/** Classify a command string into a category via the limited rule table. */
export function classifyCommand(command) {
  if (typeof command !== 'string' || !command.trim()) return 'other';
  for (const { category, re } of CATEGORY_RULES) {
    if (re.test(command)) return category;
  }
  return 'other';
}

// pi appends "Command exited with code N" to failed bash output — the only
// structured exit-code signal a bash toolResult carries.
const EXIT_CODE_RE = /Command exited with code (-?\d+)\s*$/;

function textOf(content) {
  if (!Array.isArray(content)) return '';
  return content
    .map((b) => (b && b.type === 'text' && typeof b.text === 'string' ? b.text : ''))
    .join('\n');
}

function extractExitCode(outputText) {
  const m = EXIT_CODE_RE.exec(outputText.trim());
  return m ? parseInt(m[1], 10) : null;
}

/** Truncate output for the summary (first meaningful lines, capped). */
function summarize(outputText, max = 200) {
  const t = (outputText || '').trim();
  if (!t) return '';
  const first = t.split('\n').find((l) => l.trim()) || '';
  const line = first.trim();
  return line.length > max ? line.slice(0, max) + '…' : line;
}

function msOf(entry, msg) {
  // Prefer the structured epoch-ms message.timestamp; fall back to the ISO
  // entry.timestamp. Returns null when neither is usable.
  if (typeof msg?.timestamp === 'number') return msg.timestamp;
  const t = Date.parse(entry?.timestamp || '');
  return Number.isFinite(t) ? t : null;
}

/**
 * Collect CommandResult entries from session entries, in order.
 * bashExecution → one result each. assistant toolCall (bash/read/etc.) →
 * paired with its toolResult; a bash toolCall yields a command result, other
 * tools yield a generic result with no command string.
 */
export function collectCommandResults(entries) {
  const out = [];
  if (!Array.isArray(entries)) return out;

  const results = new Map();
  for (const e of entries) {
    const m = e?.message;
    if (m?.role === 'toolResult') results.set(m.toolCallId, { msg: m, entry: e });
  }

  for (const e of entries) {
    const m = e?.message;
    if (!m) continue;

    if (m.role === 'bashExecution' && typeof m.command === 'string') {
      const cancelled = !!m.cancelled;
      const exitCode = typeof m.exitCode === 'number' ? m.exitCode : null;
      const failed = cancelled || (exitCode != null && exitCode !== 0);
      out.push({
        id: e.id ?? `bash-${out.length}`,
        command: m.command,
        category: classifyCommand(m.command),
        exitCode,
        succeeded: !cancelled && exitCode === 0,
        failed,
        cancelled,
        startedAt: msOf(e, m),
        durationMs: null, // bashExecution doesn't record duration
        outputSummary: summarize(m.output),
        source: 'bash_execution',
      });
      continue;
    }

    if (m.role === 'assistant' && Array.isArray(m.content)) {
      const callStart = msOf(e, m);
      for (const block of m.content) {
        if (block?.type !== 'toolCall') continue;
        const res = results.get(block.id);
        if (!res) continue; // no result yet — running/crashed, not a verdict
        const rmsg = res.msg;
        const details = rmsg.details || {};
        const isBash = block.name === 'bash';
        const command = isBash ? (block.arguments?.command ?? details.command ?? '') : '';
        const outText = textOf(rmsg.content);
        // Structured details win; the legacy "Command exited with code N"
        // suffix is the fallback during the migration period.
        const exitCode =
          typeof details.exitCode === 'number' ? details.exitCode : isBash ? extractExitCode(outText) : null;
        const cancelled = details.cancelled === true;
        const failed = cancelled || rmsg.isError === true;
        const endMs = msOf(res.entry, rmsg);
        const durationMs =
          typeof details.durationMs === 'number'
            ? details.durationMs
            : callStart != null && endMs != null && endMs >= callStart
              ? endMs - callStart
              : null;
        out.push({
          id: block.id ?? `tool-${out.length}`,
          command: command || `[${block.name || 'tool'}]`,
          category: isBash ? classifyCommand(command) : 'other',
          exitCode,
          succeeded: !failed,
          failed,
          cancelled,
          startedAt: callStart,
          durationMs,
          outputSummary: summarize(outText),
          source: 'tool_result',
          // Pass through an approval record when the action went through a gate.
          approval: details.approval ?? null,
        });
      }
    }
  }
  return out;
}

/**
 * Group results for the Result Card's Tests/Build/Checks sections and compute
 * recovered-error / final-failure accounting.
 */
export function summarizeCommands(results) {
  const byCategory = { test: [], build: [], lint: [], format: [], typecheck: [], git: [], other: [] };
  for (const r of results) byCategory[r.category]?.push(r);

  const failed = results.filter((r) => r.failed).length;
  const total = results.length;
  // A failure is "recovered" when a later result in the same category (or the
  // overall tail) succeeds — i.e. it's not the terminal signal.
  const lastFailed = total > 0 && results[total - 1].failed;
  const recovered = lastFailed ? failed - 1 : failed;

  return {
    byCategory,
    total,
    failed,
    recoveredErrors: Math.max(0, recovered),
    finalFailure: lastFailed,
    // Explicit warnings only — stderr presence alone is NOT a warning.
    warnings: 0,
  };
}
