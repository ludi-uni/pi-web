import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import WorkspaceDetailPage from './WorkspaceDetailPage.svelte';

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

function session(id, name, lastActivity) {
  return {
    id,
    name,
    project: 'D:\\Develop\\pi-web',
    lastActivity,
    messageCount: 3,
    model: 'claude-opus',
    modelProvider: 'anthropic',
    chatAvailable: true,
  };
}

function props(overrides = {}) {
  return {
    workspaceId: 'w1',
    fetchWorkspace: vi.fn().mockResolvedValue(workspace()),
    fetchSessions: vi.fn().mockResolvedValue({
      sessions: [
        session('a.jsonl', 'Mobile UI implementation', '2026-01-02T10:00:00Z'),
        session('b.jsonl', 'Workspace foundation', '2026-01-02T09:00:00Z'),
      ],
      total: 2,
    }),
    createSession: vi.fn().mockResolvedValue({ ok: true, id: 'new.jsonl' }),
    onTouch: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
}

// Stub the git endpoint for detail tests. getWorkspaceGitInfo calls
// getJSON('/api/git/info?path=…') — we intercept fetch globally.
function stubGit(info, ok = true) {
  const fetchImpl = vi.fn().mockImplementation((url) => {
    if (String(url).includes('/api/git/info')) {
      return Promise.resolve({ ok, json: () => Promise.resolve(ok ? info : { error: 'x' }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
  vi.stubGlobal('fetch', fetchImpl);
  return fetchImpl;
}

beforeEach(() => {
  window.history.replaceState({}, '', '/workspace?id=w1');
});

describe('WorkspaceDetailPage', () => {
  it('renders the workspace name, path, and recent sessions', async () => {
    render(WorkspaceDetailPage, { props: props() });
    expect(await screen.findByTestId('wsd-name')).toHaveTextContent('pi-web');
    expect(screen.getByText('D:\\Develop\\pi-web')).toBeTruthy();
    expect(await screen.findByText('Mobile UI implementation')).toBeTruthy();
    expect(screen.getByText('Workspace foundation')).toBeTruthy();
  });

  it('requests sessions filtered by the workspace path', async () => {
    const fetchSessions = vi.fn().mockResolvedValue({ sessions: [], total: 0 });
    render(WorkspaceDetailPage, { props: props({ fetchSessions }) });
    await waitFor(() => {
      expect(fetchSessions).toHaveBeenCalledWith({ project: 'D:\\Develop\\pi-web' });
    });
  });

  it('shows not-found state for an unknown workspace', async () => {
    render(WorkspaceDetailPage, {
      props: props({ fetchWorkspace: vi.fn().mockResolvedValue(null) }),
    });
    expect(await screen.findByText('Workspace not found')).toBeTruthy();
  });

  it('shows the empty state when there are no sessions', async () => {
    render(WorkspaceDetailPage, {
      props: props({ fetchSessions: vi.fn().mockResolvedValue({ sessions: [], total: 0 }) }),
    });
    expect(await screen.findByText('No sessions yet')).toBeTruthy();
    expect(screen.getByText(/Start a new session in this workspace/)).toBeTruthy();
  });

  it('touches the workspace exactly once after a successful load', async () => {
    const onTouch = vi.fn().mockResolvedValue({ ok: true });
    render(WorkspaceDetailPage, { props: props({ onTouch }) });
    await screen.findByTestId('wsd-name');
    await waitFor(() => expect(onTouch).toHaveBeenCalledTimes(1));
    expect(onTouch).toHaveBeenCalledWith('w1');
  });

  it('does not touch when the workspace is not found', async () => {
    const onTouch = vi.fn();
    render(WorkspaceDetailPage, {
      props: props({ fetchWorkspace: vi.fn().mockResolvedValue(null), onTouch }),
    });
    await screen.findByText('Workspace not found');
    expect(onTouch).not.toHaveBeenCalled();
  });

  it('New Session posts the workspace path and navigates to the session', async () => {
    const createSession = vi.fn().mockResolvedValue({ ok: true, id: 'new.jsonl' });
    render(WorkspaceDetailPage, { props: props({ createSession }) });
    await fireEvent.click(await screen.findByTestId('wsd-new-session'));
    await waitFor(() => {
      expect(createSession).toHaveBeenCalledWith('D:\\Develop\\pi-web', { model: undefined });
    });
    await waitFor(() => {
      expect(window.location.pathname + window.location.search).toBe('/session?id=new.jsonl');
    });
  });

  it('session cards link to /session?id=…', async () => {
    render(WorkspaceDetailPage, { props: props() });
    const card = (await screen.findByText('Mobile UI implementation')).closest('a');
    expect(card.getAttribute('href')).toBe('/session?id=a.jsonl');
  });

  it('remove confirms then navigates back to /workspaces', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });
    vi.stubGlobal('fetch', fetchImpl);

    render(WorkspaceDetailPage, { props: props() });
    await screen.findByTestId('wsd-name');
    await fireEvent.click(screen.getByTestId('wsd-menu'));
    await fireEvent.click(screen.getByText('Remove workspace'));
    // In-app confirm sheet; removal only happens after confirming.
    await screen.findByTestId('workspace-remove-modal');
    expect(window.location.pathname).toBe('/workspace');
    await fireEvent.click(screen.getByTestId('workspace-remove-confirm'));
    await waitFor(() => {
      expect(window.location.pathname).toBe('/workspaces');
    });
    vi.unstubAllGlobals();
  });

  it('shows branch + clean for a git workspace', async () => {
    stubGit({ isRepo: true, branch: 'main', hasChanges: false });
    render(WorkspaceDetailPage, { props: props() });
    await screen.findByTestId('wsd-name');
    const badge = await screen.findByTestId('ws-git-badge');
    expect(badge.textContent).toContain('main');
    expect(badge.textContent).toContain('clean');
    vi.unstubAllGlobals();
  });

  it('shows modified for a dirty workspace', async () => {
    stubGit({ isRepo: true, branch: 'mobile-ux', hasChanges: true });
    render(WorkspaceDetailPage, { props: props() });
    const badge = await screen.findByTestId('ws-git-badge');
    expect(badge.textContent).toContain('mobile-ux');
    expect(badge.textContent).toContain('modified');
    vi.unstubAllGlobals();
  });

  it('git failure does not break the page', async () => {
    stubGit({}, false);
    render(WorkspaceDetailPage, { props: props() });
    // Page still renders workspace + sessions.
    expect(await screen.findByTestId('wsd-name')).toHaveTextContent('pi-web');
    expect(await screen.findByText('Mobile UI implementation')).toBeTruthy();
    expect(await screen.findByText('Git unavailable')).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it('renders workspace settings summary when presets are set', async () => {
    stubGit({ isRepo: false });
    render(WorkspaceDetailPage, {
      props: props({
        fetchWorkspace: vi.fn().mockResolvedValue(
          workspace({
            settings: {
              model: 'openai/gpt-5',
              permissionPreset: 'full',
              quickPrompts: [{ id: 'q1', label: 'T', prompt: 'run tests' }],
            },
          }),
        ),
      }),
    });
    await screen.findByTestId('wsd-name');
    const presets = await screen.findByTestId('wsd-presets');
    expect(presets.textContent).toContain('openai/gpt-5');
    expect(presets.textContent).toContain('full');
    expect(presets.textContent).toContain('1');
    vi.unstubAllGlobals();
  });

  it('settings section expands and saves a model preset', async () => {
    stubGit({ isRepo: false });
    const fetchImpl = vi.fn().mockImplementation((url, _opts) => {
      if (String(url).includes('/api/models')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              models: [{ id: 'gpt-5', provider: 'openai', name: 'GPT-5' }],
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
    });
    vi.stubGlobal('fetch', fetchImpl);

    render(WorkspaceDetailPage, { props: props() });
    await screen.findByTestId('wsd-name');
    await fireEvent.click(screen.getByText('Workspace Settings'));
    const select = await screen.findByTestId('wsd-model');
    await fireEvent.change(select, { target: { value: 'openai/gpt-5' } });
    await waitFor(() => {
      const call = fetchImpl.mock.calls.find(
        (c) => typeof c[1]?.body === 'string' && c[1].body.includes('update-settings'),
      );
      expect(call).toBeTruthy();
      expect(JSON.parse(call[1].body).settings.model).toBe('openai/gpt-5');
    });
    vi.unstubAllGlobals();
  });

  it('quick prompt editor adds and saves a workspace prompt', async () => {
    stubGit({ isRepo: false });
    const fetchImpl = vi.fn().mockImplementation((url, _opts) => {
      if (String(url).includes('/api/models')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ models: [] }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
    });
    vi.stubGlobal('fetch', fetchImpl);

    render(WorkspaceDetailPage, { props: props() });
    await screen.findByTestId('wsd-name');
    await fireEvent.click(screen.getByText('Workspace Settings'));
    await fireEvent.click(await screen.findByTestId('wsd-qp-edit'));
    await fireEvent.click(screen.getByTestId('wsd-qp-add'));
    // Fill label + prompt of the new row.
    const rows = document.querySelectorAll('.wsd-qp-row');
    const last = rows[rows.length - 1];
    await fireEvent.input(last.querySelector('.wsd-qp-label'), { target: { value: 'Deploy' } });
    await fireEvent.input(last.querySelector('.wsd-qp-prompt'), { target: { value: 'deploy it' } });
    await fireEvent.click(screen.getByTestId('wsd-qp-save'));
    await waitFor(() => {
      const call = fetchImpl.mock.calls.find(
        (c) => typeof c[1]?.body === 'string' && c[1].body.includes('update-settings'),
      );
      expect(call).toBeTruthy();
      const qp = JSON.parse(call[1].body).settings.quickPrompts;
      expect(qp.some((p) => p.label === 'Deploy' && p.prompt === 'deploy it')).toBe(true);
    });
    vi.unstubAllGlobals();
  });

  it('New Session sends workspace model preset to /api/new-session', async () => {
    stubGit({ isRepo: false });
    const createSession = vi.fn().mockResolvedValue({ ok: true, id: 'new.jsonl' });
    render(WorkspaceDetailPage, {
      props: props({
        createSession,
        fetchWorkspace: vi
          .fn()
          .mockResolvedValue(workspace({ settings: { model: 'openai/gpt-5' } })),
      }),
    });
    await fireEvent.click(await screen.findByTestId('wsd-new-session'));
    await waitFor(() => {
      expect(createSession).toHaveBeenCalledWith('D:\\Develop\\pi-web', {
        model: 'openai/gpt-5',
      });
    });
    vi.unstubAllGlobals();
  });

  it('New Session without model preset sends no model field', async () => {
    stubGit({ isRepo: false });
    const createSession = vi.fn().mockResolvedValue({ ok: true, id: 'new.jsonl' });
    render(WorkspaceDetailPage, { props: props({ createSession }) });
    await fireEvent.click(await screen.findByTestId('wsd-new-session'));
    await waitFor(() => {
      expect(createSession).toHaveBeenCalledWith('D:\\Develop\\pi-web', {
        model: undefined,
      });
    });
    vi.unstubAllGlobals();
  });

  it('shows unavailable warning for a saved model not in the registry', async () => {
    stubGit({ isRepo: false });
    const fetchImpl = vi.fn().mockImplementation((url) => {
      if (String(url).includes('/api/models')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              models: [{ id: 'gpt-5', provider: 'openai', name: 'GPT-5' }],
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
    });
    vi.stubGlobal('fetch', fetchImpl);

    render(WorkspaceDetailPage, {
      props: props({
        fetchWorkspace: vi
          .fn()
          .mockResolvedValue(workspace({ settings: { model: 'openai/deprecated-model' } })),
      }),
    });
    await screen.findByTestId('wsd-name');
    // Model preset is shown with an unavailable warning once the registry loads.
    await waitFor(() => {
      expect(screen.getByTestId('wsd-model-unavailable')).toBeTruthy();
    });
    vi.unstubAllGlobals();
  });

  it('invalid model error from new-session is shown without navigating', async () => {
    stubGit({ isRepo: false });
    const createSession = vi
      .fn()
      .mockResolvedValue({ ok: false, error: 'model "openai/bad" is not available' });
    render(WorkspaceDetailPage, {
      props: props({
        createSession,
        fetchWorkspace: vi.fn().mockResolvedValue(workspace({ settings: { model: 'openai/bad' } })),
      }),
    });
    await fireEvent.click(await screen.findByTestId('wsd-new-session'));
    await waitFor(() => {
      expect(document.querySelector('.ws-error')?.textContent).toContain('not available');
    });
    // No navigation happened — still on the workspace detail page.
    expect(window.location.pathname).toBe('/workspace');
    vi.unstubAllGlobals();
  });

  it('renders a long path and long session titles without breaking', async () => {
    const longPath = 'D:\\' + 'very-long-directory-name\\'.repeat(8) + 'repo';
    const longTitle = 'A very long session title that keeps going '.repeat(6);
    render(WorkspaceDetailPage, {
      props: props({
        fetchWorkspace: vi.fn().mockResolvedValue(workspace({ path: longPath })),
        fetchSessions: vi.fn().mockResolvedValue({
          sessions: [session('x.jsonl', longTitle, '2026-01-02T10:00:00Z')],
          total: 1,
        }),
      }),
    });
    // Path renders inside <bdi>; assert on the title attribute which holds
    // the full un-clipped string.
    await screen.findByTestId('wsd-name');
    const pathEl = document.querySelector('.wsd-path');
    expect(pathEl?.getAttribute('title')).toBe(longPath);
    // SessionCard clamps long titles to 2 lines via CSS; the DOM still holds
    // the full text. Sessions render asynchronously after the workspace loads.
    await waitFor(() => {
      const card = document.querySelector('.session-card .session-title');
      expect(card).toBeTruthy();
      expect(card.textContent).toContain('A very long session title');
    });
  });
});
