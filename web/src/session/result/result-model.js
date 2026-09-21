/**
 * result-model.js — derive the Session Result Card from *structured* signals
 * only. No natural-language parsing: the card never guesses success/failure
 * from assistant prose.
 *
 * Inputs:
 *   - git status summary (from GET /api/git/status) — files changed, +/-
 *   - session entries — for bashExecution exit codes and toolResult isError
 *
 * Output shape (see buildResult):
 *   status: 'success' | 'partial' | 'failed' | 'unknown'
 *   files, insertions, deletions, branch, isRepo
 *   commands: { total, failed }   — bash executions with a known exit code
 *   toolErrors: number            — toolResult entries flagged isError
 *   warnings: number              — non-fatal signals (currently 0; reserved)
 *
 * Status rules (explicit-signal only):
 *   failed  — the LAST command/tool signal is a failure (non-zero exit or an
 *             unresolved isError toolResult at the tail of the session)
 *   partial — some failures occurred but the session recovered (later success)
 *   success — at least one command ran and none failed, OR work happened with
 *             no failures (files changed / artifacts) and no error signals
 *   unknown — no structured signals at all (nothing ran, nothing changed)
 */

import { collectCommandResults, summarizeCommands } from './command-result.js';

const TERMINAL_WINDOW = 1; // how many trailing signal entries define "terminal"

/** Extract the ordered list of executable signals from session entries. */
export function collectSignals(entries) {
  const signals = [];
  if (!Array.isArray(entries)) return signals;
  // Index toolResults by call id so we can pair them with their toolCall and
  // detect a dangling (never-resolved) call.
  const results = new Map();
  for (const e of entries) {
    const m = e?.message;
    if (m?.role === 'toolResult') results.set(m.toolCallId, m);
  }

  for (const e of entries) {
    const m = e?.message;
    if (!m) continue;
    if (m.role === 'bashExecution' && typeof m.command === 'string') {
      // User-ran composer command: exitCode is structured.
      if (m.cancelled) {
        signals.push({ kind: 'command', ok: false, cancelled: true });
      } else if (m.exitCode === 0) {
        signals.push({ kind: 'command', ok: true });
      } else if (m.exitCode != null) {
        signals.push({ kind: 'command', ok: false, exitCode: m.exitCode });
      }
      continue;
    }
    if (m.role === 'assistant' && Array.isArray(m.content)) {
      for (const block of m.content) {
        if (block?.type !== 'toolCall') continue;
        const r = results.get(block.id);
        if (!r) {
          // Tool call with no result yet — running or crashed; not a verdict.
          continue;
        }
        signals.push({ kind: 'tool', ok: r.isError !== true, name: block.name });
      }
    }
  }
  return signals;
}

/**
 * Build the Result Card model.
 * @param {object} opts
 * @param {Array}  opts.entries   session entries (data-model order)
 * @param {object} [opts.git]     WorkingTreeStatus payload (or null)
 * @param {number} [opts.artifactCount]
 */
export function buildResult({ entries, git = null, head = null, artifactCount = 0 } = {}) {
  const signals = collectSignals(entries);
  const failed = signals.filter((s) => !s.ok).length;
  const total = signals.length;

  const isRepo = !!git?.isRepo;
  const files = isRepo ? git.changed ?? 0 : 0;
  const insertions = isRepo ? git.insertions ?? 0 : 0;
  const deletions = isRepo ? git.deletions ?? 0 : 0;

  // Terminal verdict: look only at the tail of the signal stream so a
  // recovered error doesn't mark the whole session failed.
  const tail = signals.slice(-TERMINAL_WINDOW);
  const tailFailed = tail.length > 0 && tail.every((s) => !s.ok);

  let status;
  if (total === 0 && files === 0 && artifactCount === 0) {
    status = 'unknown';
  } else if (tailFailed) {
    status = 'failed';
  } else if (failed > 0) {
    status = 'partial';
  } else {
    status = 'success';
  }

  // Richer per-command model for the Tests/Build/Checks section + Execution
  // drawer. Reuses the same entries; kept separate from `signals` so the
  // status verdict stays simple while the card shows structured detail.
  const commands = collectCommandResults(entries);
  const cmdSummary = summarizeCommands(commands);

  return {
    status,
    isRepo,
    branch: git?.branch ?? '',
    // HEAD + upstream metadata (local refs only; ahead/behind hidden upstream-less).
    sha: head?.sha ?? '',
    subject: head?.subject ?? '',
    hasUpstream: !!head?.hasUpstream,
    ahead: head?.ahead ?? -1,
    behind: head?.behind ?? -1,
    staged: git?.staged ?? 0,
    unstaged: git?.unstaged ?? 0,
    untracked: git?.untracked ?? 0,
    files,
    insertions,
    deletions,
    commands: { total, failed },
    toolErrors: signals.filter((s) => s.kind === 'tool' && !s.ok).length,
    artifactCount,
    // Structured error accounting: a recovered error is a failure followed by
    // a later success; a final failure is the terminal signal being a failure.
    errors: cmdSummary.failed,
    recoveredErrors: cmdSummary.recoveredErrors,
    warnings: cmdSummary.warnings,
    // Per-category structured results for the Tests/Build/Checks section.
    commandResults: commands,
    byCategory: cmdSummary.byCategory,
    hasData: total > 0 || files > 0 || artifactCount > 0,
  };
}

export const __test__ = { TERMINAL_WINDOW };
