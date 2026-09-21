import { getJSON, postJSON } from '../shared/api.js';

/**
 * API client for the workspace registry (GET/POST /api/workspaces).
 * Workspaces are named, pinnable working directories — the "where do I want to
 * work" entry point. The session JSONL format is unchanged; a workspace links
 * to sessions purely by path == session.cwd.
 */

export function normalizeWorkspace(raw = {}) {
  let settings = null;
  if (raw.settings && typeof raw.settings === 'object') {
    settings = raw.settings;
  } else if (typeof raw.settings === 'string') {
    try {
      settings = JSON.parse(raw.settings);
    } catch {
      settings = null;
    }
  }
  return {
    id: raw.id || '',
    name: raw.name || '',
    path: raw.path || '',
    projectPath: raw.projectPath || '',
    pinned: !!raw.pinned,
    lastOpenedAt: raw.lastOpenedAt || '',
    sessionCount: raw.sessionCount ?? 0,
    settings,
  };
}

export async function loadWorkspaces({ fetchImpl } = {}) {
  const data = await getJSON('/api/workspaces', { fetchImpl });
  return (Array.isArray(data.workspaces) ? data.workspaces : []).map(normalizeWorkspace);
}

/**
 * Resolve one workspace by id. There is no GET /api/workspaces/:id endpoint —
 * the list is small, so we fetch it and match client-side. Returns null when
 * the id is unknown.
 */
export async function getWorkspaceById(id, { fetchImpl } = {}) {
  if (!id) return null;
  const list = await loadWorkspaces({ fetchImpl });
  return list.find((w) => w.id === id) || null;
}

async function postWorkspaceAction(body, { fetchImpl } = {}) {
  return postJSON('/api/workspaces', body, { fetchImpl });
}

export async function createWorkspace(path, name, { fetchImpl } = {}) {
  const data = await postWorkspaceAction(
    { action: 'create', path, name: name || '' },
    { fetchImpl },
  );
  return {
    workspace: normalizeWorkspace(data.workspace || {}),
    existing: !!data.existing,
  };
}

export function renameWorkspace(id, name, { fetchImpl } = {}) {
  return postWorkspaceAction({ action: 'rename', id, name }, { fetchImpl });
}

export function pinWorkspace(id, { fetchImpl } = {}) {
  return postWorkspaceAction({ action: 'pin', id }, { fetchImpl });
}

export function unpinWorkspace(id, { fetchImpl } = {}) {
  return postWorkspaceAction({ action: 'unpin', id }, { fetchImpl });
}

export function removeWorkspace(id, { fetchImpl } = {}) {
  return postWorkspaceAction({ action: 'remove', id }, { fetchImpl });
}

export function touchWorkspace(id, { fetchImpl } = {}) {
  return postWorkspaceAction({ action: 'touch', id }, { fetchImpl });
}

/**
 * Update a workspace's settings (model / permissionPreset / quickPrompts).
 * `settings` is a partial object — the backend overlays it onto the stored
 * settings_json, preserving unknown keys.
 */
export function updateWorkspaceSettings(id, settings, { fetchImpl } = {}) {
  return postWorkspaceAction({ action: 'update-settings', id, settings }, { fetchImpl });
}

/**
 * Resolve the workspace that owns a session cwd (path match, case-insensitive
 * on Windows-style paths). Returns null when no workspace matches — used to
 * scope workspace quick prompts to the session's directory.
 */
export async function getWorkspaceForPath(path, { fetchImpl } = {}) {
  if (!path) return null;
  const list = await loadWorkspaces({ fetchImpl });
  const norm = (p) =>
    String(p || '')
      .trim()
      .replace(/\\/g, '/')
      .replace(/\/+$/, '')
      .toLowerCase();
  const target = norm(path);
  return list.find((w) => norm(w.path) === target) || null;
}

/**
 * Create a session in the workspace's directory via the existing API.
 * `model` is an optional "provider/model-id" string — when set, the new
 * session starts with that model instead of the default. Omit the field
 * entirely when the workspace has no preset.
 */
export function createSessionInWorkspace(path, { model, fetchImpl } = {}) {
  const body = { path };
  if (model) body.model = model;
  return postJSON('/api/new-session', body, { fetchImpl });
}

/**
 * Fetch git info for a registered workspace path. The backend only describes
 * paths present in the workspaces registry, so this is scoped to known
 * workspaces. Returns { isRepo, branch, hasChanges, … } — the same shape as
 * the session-scoped /api/git/info?id= endpoint.
 */
export function getWorkspaceGitInfo(path, { fetchImpl } = {}) {
  return getJSON('/api/git/info?path=' + encodeURIComponent(path), { fetchImpl });
}

/**
 * List immediate subdirectories of `path` for the Add-workspace folder picker.
 * Omit `path` (or pass '') to get the default browse root — the drive list on
 * Windows, the home directory elsewhere. Returns { path, parent, dirs } where
 * `dirs` are bare names (join onto `path` to descend).
 */
export function browseDirs(path, { fetchImpl } = {}) {
  const q = path ? '?path=' + encodeURIComponent(path) : '';
  return getJSON('/api/browse-dirs' + q, { fetchImpl });
}
