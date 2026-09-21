# Data Flow & Session File Format

## Session File Format

Sessions are stored as **JSONL** files (one JSON object per line):

```
~/.pi/agent/sessions/--project-name--/
└── 2026-01-15T10-30-00.000Z_a1b2c3d4.jsonl
```

### Example JSONL Content

```jsonl
{"type":"session","version":3,"id":"uuid","timestamp":"2026-01-15T10:30:00Z","cwd":"/Users/me/project","name":"My Session"}
{"type":"message","timestamp":"2026-01-15T10:30:01Z","message":{"role":"user","content":"Hello"}}
{"type":"message","timestamp":"2026-01-15T10:30:05Z","message":{"role":"assistant","content":"Hi!"},"usage":{"totalTokens":42,"cost":{"total":0.0001}}}
{"type":"session_info","timestamp":"2026-01-15T10:30:06Z","name":"Renamed Session"}
{"type":"tool_call","timestamp":"2026-01-15T10:30:06Z","tool":"bash","command":"ls -la"}
{"type":"tool_result","timestamp":"2026-01-15T10:30:07Z","tool":"bash","output":"..."}
{"type":"branch_summary","timestamp":"2026-01-15T10:35:00Z","branch":"main","summary":"..."}
{"type":"compaction","timestamp":"2026-01-15T10:40:00Z","before":"...","after":"..."}
```

### Entry Types

| `type` | Description |
|--------|-------------|
| `session` | Header metadata (cwd, name, version, id) |
| `message` | User or assistant message with optional `usage` and `cost` |
| `session_info` | Session metadata update; latest `name` is used as display title |
| `tool_call` | Agent invoked a tool |
| `tool_result` | Tool execution result |
| `bash` / `bash_output` | Shell command and its output |
| `branch_summary` | Summary of work on a git branch |
| `compaction` | Conversation history was compacted |
| `model_change` | Model switched mid-session |
| `thinking_level_change` | Thinking level changed mid-session |
| `diff` | Code diff output from edit/tool operations |

### Project Directory Encoding

Project names are filesystem-safe encoded:

```go
EncodeProjectName("/Users/me/project") → "--Users-me-project--"
DecodeProjectName("--Users-me-project--") → "/Users/me/project"
```

## Parse Flow

```
File on disk
     │
     ▼
sessions.ParseFile(path, dirName, fileName)
     │
     ├──▶ stream file line-by-line
     │
     ├──▶ json.Unmarshal each line
     │        ├──▶ type=="session" → sess.Header
     │        ├──▶ type=="message" → increment MessageCount, sum tokens/cost
     │        ├──▶ type=="session_info" → latest rename/title metadata
     │        └──▶ all types → append to Entries
     │
     ├──▶ Name = latest session_info.name, else session.name, else first user text, else filename
     ├──▶ Model = last message model or last model_change modelId
     ├──▶ ModelProvider = provider for last-known model
     ├──▶ LastActivity = latest timestamp (or file modtime fallback)
     │
     └──▶ ChatAvailable = cwd still exists?
```

## Cache Strategy

`sessions.Cache` avoids re-parsing unchanged files:

```
LoadAll(dir)
    │
    ├──▶ ReadDir all project subdirs
    │
    ├──▶ For each .jsonl file:
    │         ├──▶ Check modtime against cache
    │         ├──▶ MATCH → return cached SessionSummary
    │         └──▶ MISMATCH → ParseSummary + store in cache
    │
    ├──▶ Evict files no longer on disk
    │
    └──▶ SortByActivity (descending by timestamp)
```

## Data Flow: Viewing a Session

```
Browser GET /session?id=<id>
           │
           ▼
    server.handleSession → SPA shell
           │
           ▼
Browser GET /api/session?id=<id>
           │
           ▼
    server.handleApiSession
           │
           ├──▶ sessions.Cache.Resolve → find file path + parse/cache by modtime
           │
           ├──▶ sessions.ParseFile → Session struct when cache is stale
           │
           └──▶ Write JSON response for SessionPage.svelte
```

## Data Flow: Chat Message

```
Browser POST /api/chat?id=<id>
           │
           ▼
    server.handleChat
           │
           ├──▶ sessions.ResolveByID → Session + Path
           │
           ├──▶ chat.ParseRequest(r)
           │         ├──▶ ParseMultipartForm
           │         ├──▶ Extract text + image files
           │         └──▶ Validate (not empty, image size, mime type)
           │
           ├──▶ workers.Manager.Send(ctx, sessionID, sessionPath, chatReq)
           │         │
           │         ├──▶ Get or create ChatWorker for session
           │         │         └──▶ rpc.NewPiWorkerWithStream(sessionPath, streamSink)
           │         │               ├──▶ exec.Command("pi", "--mode", "rpc")
           │         │               ├──▶ Start subprocess
           │         │               ├──▶ switch_session RPC
           │         │               └──▶ Background goroutines: consume stdout, wait
           │         │
           │         └──▶ worker.Prompt(ctx, chatReq)
           │               ├──▶ BuildPromptCommand (JSONL to stdin)
           │               ├──▶ Await response on pending channel
           │               └──▶ Update status → running
           │
           └──▶ Return {"ok": true, "status": "accepted"}
```

## Data Flow: Rename Session

```
Browser POST /api/rename-session?id=<id>
           │
           ▼
    server.handleRenameSession
           │
           ├──▶ Decode JSON body → {"name":"New Name"}
           ├──▶ Resolve session ID → filesystem path
           ├──▶ sessions.RenameSession(path, name, now)
           │         └──▶ Append JSONL line: {"type":"session_info","timestamp":"...","name":"New Name"}
           ├──▶ record modtime + broadcast "reload" to session SSE clients
           │
           └──▶ Return {"ok": true, "name": "New Name"}
```

Rename is the only intentional pi-web write to an existing session JSONL file. It appends metadata history; it does not rewrite existing entries. Creating a new session is the other direct write path, but it only creates a fresh JSONL file.

## Data Flow: Live Reload

```
Editor saves session file
           │
           ▼
    fsnotify detects Write event
           │
           ▼
    debouncer.schedule(path)  (50ms debounce)
           │
           ▼
    Server.recordModTime(sessID, modTime)
           │
           ├──▶ Update fileMod map
           ├──▶ Broadcast "reload" to SSE clients for this sessID
           └──▶ Recompute running status → broadcast status-delta
           │
           ▼
    Browser EventSource receives "reload"
           └──▶ fetch /api/session
                └──▶ append/upsert canonical entries and clear preview
```

## Data Flow: Session Attention (Inbox + Push)

The Inbox and push notifications share one server-side model in the
`session_attention` SQLite table (`internal/server/attention.go`). It is driven
by the running-state transition in `recomputeAndBroadcastStatus`:

```
Worker transitions running → idle
           │
           ▼
    updateAttentionOnIdle(sessionID)
           │
           ├──▶ Resolve session, scanAttentionTail(entries)
           │      ├── waiting: last ask_user_question toolResult has
           │      │             details.awaitingChatReply=true and no user reply
           │      └── failed:  last entry is an errored toolResult, or an
           │                  assistant toolCall with no matching toolResult
           │
           ├──▶ Write waiting/failed/completed_at to session_attention
           ├──▶ broadcast "attention" SSE on __all__ (open index pages refresh)
           └──▶ push.NotifyAttention(sessionID, kind, title)  (dedupe: only on
                                                           a flag change)

User opens the session page
           │
           ▼
    POST /api/session/viewed?id=...
           └──▶ last_viewed_at = now  →  completed-unread clears
```

`GET /api/attention` returns a self-contained `items` list — each entry carries
the attention state plus name/project/lastActivity/kind/running — so the Inbox
renders needs-attention sessions without depending on the 100-item
`/api/sessions` page window. The frontend (`web/src/index/attention.js`) groups
items into buckets (waiting_input / approval_required / failed /
completed_unread / running). `approval_required` is reserved — no approval flow
exists yet.

`GET /api/session/last-viewed` returns the most recently viewed session for the
"Continue last session" link on the index.

## Data Flow: Session Result Card

The Result Card on the session page summarizes "what this session did" using
structured signals only — never assistant prose:

```
<ResultCard> mounts
   │
   ├──▶ GET /api/git/status?id=<id>   → branch, clean, staged/unstaged/untracked, +/-
   ├──▶ session entries               → bashExecution exitCode + toolResult isError
   └──▶ collectArtifacts(entries)     → generated-file count
           │
           ▼
   buildResult() → status success/partial/failed/unknown
   (failed only when the LAST signal is a failure; recovered → partial)
```

"View changes" opens the existing DiffModal (`/api/git/diff`). "Changed files"
lazy-loads `/api/git/files`, and tapping a row lazy-loads `/api/git/file-diff`
for that single path — the full diff is never fetched up front. Both the modal
and the per-file list accept `?mode=working|staged|unstaged` (a fixed enum —
never a raw git arg). The card refetches on `pi-session-reload` and
`pi-attention` (idle transition), not on a polling timer.

The Tests/Build/Checks section and Execution drawer come from
`command-result.js`: `bashExecution.exitCode`/`cancelled` and bash
toolCall→toolResult (`isError` + the "Command exited with code N" suffix).
Commands are classified by a limited rule table (test/build/lint/format/
typecheck/git/other) — ambiguous commands are `other`, never AI-inferred. A
failure followed by a later success is a "recovered error"; only a terminal
failure marks the session failed.

## Approval pipeline

Pi's RPC worker emits `approval_*` stream events when the execution gate pauses
a dangerous action. The full path is now live:

```
pi (execution gate) ── approval_required ──▶ piRPCWorker.handleRPCLine
   │                                          (approval_* case)
   ▼
approvalSink ──▶ Server.IngestApprovalEvent
   │  ├─ approvalStore.reduce (unique id, single decision, stale/expired safe)
   │  ├─ markApprovalRequired → session_attention.approval → Inbox
   │  ├─ push.NotifyAttention (title only, no command/secrets)
   │  └─ broadcastApprovalEvent → `approval` SSE on the session topic
   ▼
SessionPage approval-store.js → pendingApprovals → ApprovalCard
   │
   ▼ Approve / Reject
POST /api/approval/decide {approvalId, decision, sessionId}
   │  ├─ approvals.decide (idempotent, stale/cross-session rejected)
   │  └─ Manager.SendApprovalResponse → worker `approval_response` RPC
   ▼
pi resumes the held action (approve) or aborts it (reject/expire)
   └── approval_resolved/rejected stream event → card removed via SSE
```

- Events: `approval_required` / `approval_resolved` / `approval_rejected` /
  `approval_expired` (snake_case wire fields).
- The decision endpoint trusts only `approvalId` + `decision` — the action
  payload never crosses the client boundary, so only the exact held action can
  resume.
- `GET /api/approvals?id=` seeds the page's approval store on mount and on
  `pi-session-reload`, closing the race where `approval_required` fired before
  the SSE listener attached.
- `internal/policy/approval_policy.go` classifies commands: a read-only
  allowlist (git status/diff/log, go test/build, npm test/lint/build, etc.)
  bypasses approval; mutations (git push/commit, rm/del, publish, deploy,
  network, system changes) and any unrecognized command require it. Compound
  commands (`&&`, `;`, `|`, `-c` wrappers) must be entirely read-only to
  bypass — unknown mutation fails safe to approval.

## Data Flow: Share to Gist

```
Browser POST /share?id=<id>
           │
           ▼
    server.handleShare
           │
           ├──▶ share.FindGh → locate `gh` CLI
           │
           ├──▶ gh auth status → verify login
           │
           ├──▶ deps.Resolve(id) → find matching session
           │
           ├──▶ renderExportSessionPage(session)  (no live chrome)
           │
           ├──▶ Write to temp file
           │
           ├──▶ gh gist create --public=false <tmpfile>
           │
           └──▶ Return {gistUrl, gistId, previewUrl}
```

## Data Flow: Create New Session

```
Browser POST /api/new-session
           │
           ▼
    server.handleNewSession
           │
           ├──▶ Decode JSON body → extract path and optional sourceSessionId
           │
           ├──▶ If sourceSessionId is present, read current worker model/thinking state
           │
           ├──▶ Validate path (absolute, exists or create)
           │
           ├──▶ Encode project name → create directory under sessionsDir
           │
           ├──▶ Generate UUID + timestamp → write fresh JSONL file
           │         ├──▶ session header entry
           │         └──▶ implicit model_change / thinking_level_change entries when copied
           │              from the source session. These entries include normal entry `id`
           │              and `parentId` fields so `pi --mode rpc switch_session` restores
           │              the same initial model/thinking state.
           │
           ├──▶ Pre-initialize chat worker (EnsureWorker)
           │         └──▶ So the session page can read default model/thinking level immediately
           │
           └──▶ Return {"ok": true, "id": <filename>}
```

## Data Flow: Fork Session

```
Browser POST /api/fork-session?id=<sourceId>
           │
           ▼
    server.handleApiForkSession
           │
           ├──▶ Decode JSON body → {"entryId": "..."}
           ├──▶ Resolve source session ID → filesystem path
           ├──▶ sessions.ForkSessionFile(sessionsDir, sourcePath, entryId, now)
           │         ├──▶ Parse source session into by-ID map
           │         ├──▶ Walk from entryId back to root (via parentId)
           │         ├──▶ Reverse to chronological order
           │         ├──▶ Create new session header with parentSession reference + forkedFrom
           │         └──▶ Write new JSONL file in same project directory
           ├──▶ Initialize worker for the new session (async)
           │
           └──▶ Return {"ok": true, "id": <newFilename>}
```

## Data Flow: Clone Session

```
Browser POST /api/clone-session?id=<sourceId>
           │
           ▼
    server.handleApiCloneSession
           │
           ├──▶ Decode JSON body → {"leafId": "..."}  (optional, defaults to last entry)
           ├──▶ Resolve source session ID → filesystem path
           ├──▶ sessions.CloneSessionFile(sessionsDir, sourcePath, leafId, now)
           │         ├──▶ Parse source session into by-ID map
           │         ├──▶ Walk from leafId back to root (via parentId)
           │         ├──▶ Reverse to chronological order
           │         ├──▶ Create new session header with parentSession reference
           │         └──▶ Write new JSONL file in same project directory
           ├──▶ Initialize worker for the new session (async)
           │
           └──▶ Return {"ok": true, "id": <newFilename>}
```

## Data Flow: Scratchpad (Notes)

```
Browser GET /api/scratchpad?project=<cwd>
           │
           ▼
    server.handleGetScratchpad
           │
           ├──▶ Query SQLite: SELECT content FROM scratchpads WHERE project_path = ?
           │
           └──▶ Return {"content": "..."}  (empty string if no notes exist)

Browser POST /api/scratchpad
           │
           ▼
    server.handleSaveScratchpad
           │
           ├──▶ Decode JSON body → {"project": "...", "content": "...", "mode": "replace"|"append"}
           ├──▶ UPSERT into SQLite (replace is default; append concatenates atomically)
           ├──▶ Broadcast SSE "scratchpad" on __all__ so an open sidebar can reload
           │
           └──▶ Return {"ok": true, "content": "..."}
```
```
