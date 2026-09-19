import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import WorkspacesPage from './WorkspacesPage.svelte';

function workspace(overrides = {}) {
  return {
    id: 'w1',
    name: 'pi-web',
    path: 'D:\\Develop\\pi-web',
    projectPath: '',
    pinned: false,
    lastOpenedAt: '',
    sessionCount: 0,
    ...overrides,
  };
}

function props(overrides = {}) {
  return {
    fetchWorkspaces: vi.fn().mockResolvedValue([workspace()]),
    fetchRecent: vi.fn().mockResolvedValue({ locations: [] }),
    fetchProjects: vi.fn().mockResolvedValue({ projects: [] }),
    createSession: vi.fn().mockResolvedValue({ ok: true, id: 'new.jsonl' }),
    ...overrides,
  };
}

// navigation.js writes pushState; jsdom supports it but we assert on the URL.
beforeEach(() => {
  window.history.replaceState({}, '', '/workspaces');
});

describe('WorkspacesPage', () => {
  it('renders the workspace list with name and path', async () => {
    render(WorkspacesPage, { props: props() });
    expect(await screen.findByText('pi-web')).toBeTruthy();
    expect(screen.getByText('D:\\Develop\\pi-web')).toBeTruthy();
  });

  it('shows the empty state when no workspaces exist', async () => {
    render(WorkspacesPage, {
      props: props({ fetchWorkspaces: vi.fn().mockResolvedValue([]) }),
    });
    expect(await screen.findByText('No workspaces yet')).toBeTruthy();
  });

  it('New Session posts the workspace path to /api/new-session and navigates', async () => {
    const createSession = vi.fn().mockResolvedValue({ ok: true, id: 'new.jsonl' });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });
    vi.stubGlobal('fetch', fetchImpl);

    render(WorkspacesPage, { props: props({ createSession }) });
    const btn = await screen.findByTestId('workspace-new-session');
    await fireEvent.click(btn);

    await waitFor(() => {
      expect(createSession).toHaveBeenCalledWith('D:\\Develop\\pi-web', { model: undefined });
    });
    await waitFor(() => {
      expect(window.location.pathname + window.location.search).toBe(
        '/session?id=new.jsonl',
      );
    });
    // touch fires after a successful create.
    await waitFor(() => {
      const touched = fetchImpl.mock.calls.some(
        (c) => typeof c[1]?.body === 'string' && c[1].body.includes('"action":"touch"'),
      );
      expect(touched).toBe(true);
    });
    vi.unstubAllGlobals();
  });

  it('does not navigate when session creation fails', async () => {
    const createSession = vi.fn().mockResolvedValue({ error: 'boom' });
    render(WorkspacesPage, { props: props({ createSession }) });
    await fireEvent.click(await screen.findByTestId('workspace-new-session'));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('boom');
    });
    expect(window.location.pathname).toBe('/workspaces');
  });

  it('Add Workspace submits path + name via the create action', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ ok: true, workspace: { id: 'w2', name: 'x', path: '/x' } }),
    });
    vi.stubGlobal('fetch', fetchImpl);

    render(WorkspacesPage, { props: props() });
    await fireEvent.click(await screen.findByTestId('workspace-add'));
    await fireEvent.input(screen.getByLabelText(/working directory/i), {
      target: { value: '/x' },
    });
    await fireEvent.input(screen.getByLabelText(/name/i), {
      target: { value: 'x' },
    });
    await fireEvent.click(screen.getByTestId('workspace-add-submit'));

    await waitFor(() => {
      const created = fetchImpl.mock.calls.some(
        (c) =>
          typeof c[1]?.body === 'string' &&
          c[1].body.includes('"action":"create"') &&
          c[1].body.includes('"path":"/x"'),
      );
      expect(created).toBe(true);
    });
    vi.unstubAllGlobals();
  });

  it('shows suggested workspaces from projects and recent locations', async () => {
    render(WorkspacesPage, {
      props: props({
        fetchProjects: vi.fn().mockResolvedValue({
          projects: [
            { path: 'D:\\Develop\\pi-web' }, // already registered → filtered
            { path: 'D:\\Develop\\doll' },
          ],
        }),
        fetchRecent: vi
          .fn()
          .mockResolvedValue({ locations: ['D:\\Develop\\doll', 'C:\\other'] }),
      }),
    });
    await fireEvent.click(await screen.findByTestId('workspace-add'));
    const sug = await screen.findByTestId('workspace-suggestions');
    // deduped, unregistered only
    expect(sug.textContent).toContain('D:\\Develop\\doll');
    expect(sug.textContent).toContain('C:\\other');
    const chips = sug.querySelectorAll('.ws-suggestion-chip');
    const chipTexts = Array.from(chips).map((c) => c.textContent);
    expect(chipTexts).not.toContain('D:\\Develop\\pi-web');
    expect(chipTexts).toHaveLength(2);
  });

  it('remove asks for confirmation before deleting', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });
    vi.stubGlobal('fetch', fetchImpl);

    render(WorkspacesPage, { props: props() });
    await fireEvent.click(await screen.findByTestId('workspace-menu'));
    await fireEvent.click(screen.getByText('Remove workspace'));
    expect(confirmSpy).toHaveBeenCalled();
    const removed = fetchImpl.mock.calls.some(
      (c) => typeof c[1]?.body === 'string' && c[1].body.includes('"action":"remove"'),
    );
    expect(removed).toBe(false);
    confirmSpy.mockRestore();
    vi.unstubAllGlobals();
  });
});
