import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import WorkspaceQuickAccess from './WorkspaceQuickAccess.svelte';

function workspace(overrides = {}) {
  return {
    id: 'w1',
    name: 'pi-web',
    path: 'D:\\Develop\\pi-web',
    pinned: true,
    sessionCount: 0,
    settings: {},
    ...overrides,
  };
}

describe('WorkspaceQuickAccess', () => {
  it('renders nothing when no workspaces are pinned', () => {
    const { container } = render(WorkspaceQuickAccess, {
      props: { workspaces: [workspace({ pinned: false })] },
    });
    expect(container.querySelector('[data-testid="workspace-quick-access"]')).toBeNull();
  });

  it('renders pinned workspaces as quick-start chips', () => {
    render(WorkspaceQuickAccess, {
      props: { workspaces: [workspace()] },
    });
    expect(screen.getByTestId('workspace-quick-access')).toBeTruthy();
    expect(screen.getByTestId('workspace-quick-chip')).toBeTruthy();
    expect(screen.getByText('pi-web')).toBeTruthy();
  });

  it('shows a browse-all link to /workspaces', () => {
    render(WorkspaceQuickAccess, {
      props: { workspaces: [workspace()] },
    });
    const link = screen.getByText('Browse all');
    expect(link.closest('a').getAttribute('href')).toBe('/workspaces');
  });

  it('creates a session when a workspace chip is clicked', async () => {
    const onNewSession = vi.fn();
    const createSession = vi.fn().mockResolvedValue({ ok: true, id: 'new.jsonl' });
    render(WorkspaceQuickAccess, {
      props: { workspaces: [workspace()], createSession, onNewSession },
    });
    await fireEvent.click(screen.getByTestId('workspace-quick-chip'));
    expect(createSession).toHaveBeenCalledWith('D:\\Develop\\pi-web', { model: undefined });
  });

  it('falls back to the new-session modal when creation fails', async () => {
    const onNewSession = vi.fn();
    const createSession = vi.fn().mockRejectedValue(new Error('network'));
    render(WorkspaceQuickAccess, {
      props: { workspaces: [workspace()], createSession, onNewSession },
    });
    await fireEvent.click(screen.getByTestId('workspace-quick-chip'));
    expect(onNewSession).toHaveBeenCalledWith('D:\\Develop\\pi-web');
  });
});
