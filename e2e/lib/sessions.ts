import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestInfo } from "@playwright/test";

/**
 * A real, existing directory to use as a session cwd. Chat is disabled
 * ("View only") when the session's cwd does not exist on disk
 * (internal/sessions/session.go), so chat specs must point at a real path.
 */
export function realWorkingDir(): string {
  return mkdtempSync(join(tmpdir(), "pi-web-e2e-cwd-"));
}

/**
 * A real git repository to use as a session cwd, so the Result Card's
 * /api/git/* endpoints return real data. Seeds one commit, one modified
 * tracked file, one staged file and one untracked file. Returns "" when git
 * is unavailable so specs can skip.
 */
export function realGitWorkingDir(): string {
  const dir = realWorkingDir();
  try {
    const run = (args: string[]) =>
      execFileSync("git", args, { cwd: dir, stdio: "ignore" });
    run(["init", "-q"]);
    run(["config", "user.email", "e2e@example.com"]);
    run(["config", "user.name", "e2e"]);
    writeFileSync(join(dir, "tracked.txt"), "line1\nline2\n");
    writeFileSync(join(dir, "staged.txt"), "a\n");
    run(["add", "."]);
    run(["commit", "-qm", "init"]);
    // Unstaged modification + a new staged file + an untracked file.
    writeFileSync(join(dir, "tracked.txt"), "line1\nCHANGED\nline3\n");
    writeFileSync(join(dir, "staged.txt"), "a\nb\n");
    run(["add", "staged.txt"]);
    writeFileSync(join(dir, "untracked.txt"), "fresh\n");
    return dir;
  } catch {
    return "";
  }
}

/**
 * Per-test session file management. Mutating specs (live-reload, chat) each
 * create their own uniquely-named session so the 7 parallel projects never
 * interfere with one another or with the committed read-only fixtures.
 */

let counter = 0;

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/** Unique session filename (incl. .jsonl) safe across projects + workers. */
export function uniqueSessionName(testInfo: TestInfo, prefix = "t"): string {
  const p = slug(testInfo.project.name);
  return `${prefix}-${p}-w${testInfo.workerIndex}-${Date.now()}-${counter++}.jsonl`;
}

let idSeq = 0;
function nextId(): string {
  return `e2e-${Date.now().toString(36)}-${idSeq++}`;
}

export interface MinimalEntryOpts {
  cwd?: string;
  modelId?: string;
  provider?: string;
}

/**
 * Build a minimal but valid session: header, model, thinking, one user turn and
 * one assistant reply. Returns the entries plus the id of the last entry so
 * callers can chain appended entries onto the active path.
 */
export function buildSession(opts: MinimalEntryOpts = {}) {
  const { cwd = "/home/user/live-demo", modelId = "claude-opus-4-7", provider = "anthropic" } = opts;
  const now = new Date().toISOString();
  const sessionId = `019e0000-0000-7000-8000-${(idSeq++).toString().padStart(12, "0")}`;

  const mId = nextId();
  const tId = nextId();
  const uId = nextId();
  const aId = nextId();

  const entries = [
    { type: "session", version: 3, id: sessionId, timestamp: now, cwd },
    { type: "model_change", id: mId, parentId: null, timestamp: now, provider, modelId },
    { type: "thinking_level_change", id: tId, parentId: mId, timestamp: now, thinkingLevel: "medium" },
    {
      type: "message",
      id: uId,
      parentId: tId,
      timestamp: now,
      message: { role: "user", content: [{ type: "text", text: "Initial prompt." }], timestamp: Date.now() },
    },
    {
      type: "message",
      id: aId,
      parentId: uId,
      timestamp: now,
      message: { role: "assistant", content: [{ type: "text", text: "Initial reply." }], timestamp: Date.now() },
    },
  ];
  return { entries, lastId: aId };
}

/** Build a bashExecution message entry (composer-run command with exit code). */
export function bashExecutionEntry(parentId: string, command: string, exitCode: number | null, output = "") {
  const id = nextId();
  return {
    id,
    entry: {
      type: "message",
      id,
      parentId,
      timestamp: new Date().toISOString(),
      message: { role: "bashExecution", command, exitCode, output, timestamp: Date.now() },
    },
  };
}

/** Build an assistant text message entry chained onto parentId. */
export function assistantTextEntry(parentId: string, text: string) {
  const id = nextId();
  return {
    id,
    entry: {
      type: "message",
      id,
      parentId,
      timestamp: new Date().toISOString(),
      message: { role: "assistant", content: [{ type: "text", text }], timestamp: Date.now() },
    },
  };
}

/** Write a new session file into the watched sessions dir. Returns its id (filename). */
export function writeSession(sessionsDir: string, name: string, entries: unknown[]): string {
  // Reuse a subdir seeded at server startup so the fsnotify watcher already
  // watches it (a freshly-created subdir races the watcher's dynamic w.Add and
  // kqueue won't report writes to files in an unwatched dir).
  const dir = join(sessionsDir, "--home-user-demo-project--");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return name;
}

/** Append a single entry line to an existing session file. */
export function appendEntry(sessionsDir: string, name: string, entry: unknown): void {
  // Reuse a subdir seeded at server startup so the fsnotify watcher already
  // watches it (a freshly-created subdir races the watcher's dynamic w.Add and
  // kqueue won't report writes to files in an unwatched dir).
  const dir = join(sessionsDir, "--home-user-demo-project--");
  appendFileSync(join(dir, name), JSON.stringify(entry) + "\n");
}
