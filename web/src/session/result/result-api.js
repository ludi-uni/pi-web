import { getJSON } from '../../shared/api.js';

// Read-only git endpoints for the Result Card / changed-files / per-file diff.
// All take a session id; the server resolves the repo cwd and validates paths.

export function getGitStatus(sessionId, { getImpl = getJSON } = {}) {
  return getImpl(`/api/git/status?id=${encodeURIComponent(sessionId)}`);
}

export function getChangedFiles(sessionId, { getImpl = getJSON, mode = 'working' } = {}) {
  return getImpl(
    `/api/git/files?id=${encodeURIComponent(sessionId)}&mode=${encodeURIComponent(mode)}`,
  );
}

export function getFileDiff(sessionId, path, { getImpl = getJSON, mode = 'working' } = {}) {
  return getImpl(
    `/api/git/file-diff?id=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}&mode=${encodeURIComponent(mode)}`,
  );
}

export function getGitHead(sessionId, { getImpl = getJSON } = {}) {
  return getImpl(`/api/git/head?id=${encodeURIComponent(sessionId)}`);
}

// Returns a URL (not a fetch) so callers can open/download the file directly.
export function gitFileUrl(sessionId, path, { download = false } = {}) {
  const base = `/api/git/file?id=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`;
  return download ? `${base}&download=1` : base;
}
