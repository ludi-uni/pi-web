import { describe, expect, it, vi } from 'vitest';
import {
  normalizeWorkspace,
  loadWorkspaces,
  createWorkspace,
  renameWorkspace,
  pinWorkspace,
  unpinWorkspace,
  removeWorkspace,
  touchWorkspace,
  createSessionInWorkspace,
} from './workspaces.js';

function fakeFetch(payload, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    json: () => Promise.resolve(payload),
  });
}

describe('workspaces api client', () => {
  it('normalizes raw workspace entries', () => {
    expect(
      normalizeWorkspace({
        id: 'w1',
        name: 'pi-web',
        path: 'D:\\Develop\\pi-web',
        pinned: true,
        lastOpenedAt: '2026-01-01 10:00:00',
        sessionCount: 4,
        projectPath: 'D:\\Develop\\pi-web',
      }),
    ).toEqual({
      id: 'w1',
      name: 'pi-web',
      path: 'D:\\Develop\\pi-web',
      projectPath: 'D:\\Develop\\pi-web',
      pinned: true,
      lastOpenedAt: '2026-01-01 10:00:00',
      sessionCount: 4,
      settings: null,
    });
    expect(normalizeWorkspace({})).toMatchObject({
      id: '',
      pinned: false,
      sessionCount: 0,
    });
    // settings_json round-trips as an object.
    expect(
      normalizeWorkspace({ settings: { model: 'm', quickPrompts: [{ id: 'a', label: 'A', prompt: 'p' }] } }).settings.model,
    ).toBe('m');
  });

  it('loadWorkspaces fetches and normalizes the list', async () => {
    const fetchImpl = fakeFetch({
      workspaces: [{ id: 'w1', name: 'a', path: '/a' }],
    });
    const list = await loadWorkspaces({ fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith('/api/workspaces', expect.any(Object));
    expect(list).toEqual([
      expect.objectContaining({ id: 'w1', name: 'a', path: '/a' }),
    ]);
  });

  it('loadWorkspaces tolerates a missing payload', async () => {
    const list = await loadWorkspaces({ fetchImpl: fakeFetch({}) });
    expect(list).toEqual([]);
  });

  it('createWorkspace posts the create action', async () => {
    const fetchImpl = fakeFetch({
      ok: true,
      workspace: { id: 'w1', name: 'x', path: '/x' },
    });
    const result = await createWorkspace('/x', 'x', { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/workspaces',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'create', path: '/x', name: 'x' }),
      }),
    );
    expect(result.workspace.id).toBe('w1');
    expect(result.existing).toBe(false);
  });

  it('createWorkspace surfaces the existing flag on duplicates', async () => {
    const fetchImpl = fakeFetch({
      ok: true,
      existing: true,
      workspace: { id: 'w1', name: 'x', path: '/x' },
    });
    const result = await createWorkspace('/x', '', { fetchImpl });
    expect(result.existing).toBe(true);
    expect(result.workspace.id).toBe('w1');
  });

  it('action helpers post the right action names', async () => {
    const fetchImpl = fakeFetch({ ok: true });
    await renameWorkspace('w1', 'n', { fetchImpl });
    await pinWorkspace('w1', { fetchImpl });
    await unpinWorkspace('w1', { fetchImpl });
    await removeWorkspace('w1', { fetchImpl });
    await touchWorkspace('w1', { fetchImpl });
    const bodies = fetchImpl.mock.calls.map((c) => JSON.parse(c[1].body));
    expect(bodies.map((b) => b.action)).toEqual([
      'rename',
      'pin',
      'unpin',
      'remove',
      'touch',
    ]);
    expect(bodies.every((b) => b.id === 'w1')).toBe(true);
  });

  it('createSessionInWorkspace reuses /api/new-session with the workspace path', async () => {
    const fetchImpl = fakeFetch({ ok: true, id: 's1.jsonl' });
    const result = await createSessionInWorkspace('D:\\Develop\\pi-web', { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/new-session',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ path: 'D:\\Develop\\pi-web' }),
      }),
    );
    expect(result.id).toBe('s1.jsonl');
  });
});
