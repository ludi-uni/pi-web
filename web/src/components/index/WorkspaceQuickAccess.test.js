import { describe, expect, it, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import WorkspaceQuickAccess from './WorkspaceQuickAccess.svelte';

function stubMobile(matches) {
  vi.stubGlobal('matchMedia', undefined);
  window.matchMedia = vi.fn(() => ({
    matches,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

afterEach(() => {
  delete window.matchMedia;
  vi.unstubAllGlobals();
});

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
  it('renders nothing when no workspaces exist', () => {
    const { container } = render(WorkspaceQuickAccess, {
      props: { workspaces: [] },
    });
    expect(container.querySelector('[data-testid="workspace-quick-access"]')).toBeNull();
  });

  it('renders all workspaces sorted by pinned then lastOpenedAt', () => {
    render(WorkspaceQuickAccess, {
      props: {
        workspaces: [
          workspace({ id: 'w1', name: 'unpinned-old', pinned: false, lastOpenedAt: '2024-01-01' }),
          workspace({ id: 'w2', name: 'pinned', pinned: true }),
          workspace({ id: 'w3', name: 'unpinned-new', pinned: false, lastOpenedAt: '2024-06-01' }),
        ],
      },
    });
    const chips = screen.getAllByTestId('workspace-quick-chip');
    expect(chips[0].textContent).toContain('pinned');
    expect(chips[1].textContent).toContain('unpinned-new');
    expect(chips[2].textContent).toContain('unpinned-old');
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

  it('navigates to the workspace detail page when a chip is clicked', async () => {
    render(WorkspaceQuickAccess, {
      props: { workspaces: [workspace()] },
    });
    await fireEvent.click(screen.getByTestId('workspace-quick-chip'));
    expect(window.location.pathname + window.location.search).toBe('/workspace?id=w1');
  });

  it('caps the chip list on mobile and offers a view-all chip', async () => {
    stubMobile(true);
    const many = Array.from({ length: 9 }, (_, i) =>
      workspace({ id: `w${i}`, name: `ws-${i}`, pinned: false }),
    );
    render(WorkspaceQuickAccess, { props: { workspaces: many } });
    await waitFor(() => {
      expect(screen.getAllByTestId('workspace-quick-chip')).toHaveLength(6);
    });
    const more = screen.getByTestId('workspace-quick-more');
    expect(more.textContent).toContain('9');
    expect(more.getAttribute('href')).toBe('/workspaces');
  });

  it('shows every workspace on desktop widths', async () => {
    stubMobile(false);
    const many = Array.from({ length: 9 }, (_, i) =>
      workspace({ id: `w${i}`, name: `ws-${i}`, pinned: false }),
    );
    render(WorkspaceQuickAccess, { props: { workspaces: many } });
    await waitFor(() => {
      expect(screen.getAllByTestId('workspace-quick-chip')).toHaveLength(9);
    });
    expect(screen.queryByTestId('workspace-quick-more')).toBeNull();
  });
});
