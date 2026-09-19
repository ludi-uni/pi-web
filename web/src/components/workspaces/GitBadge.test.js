import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import GitBadge from './GitBadge.svelte';

describe('GitBadge', () => {
  it('shows branch + clean for a clean repo', () => {
    render(GitBadge, {
      props: { info: { isRepo: true, branch: 'main', hasChanges: false }, state: 'ok' },
    });
    const badge = screen.getByTestId('ws-git-badge');
    expect(badge.textContent).toContain('main');
    expect(badge.textContent).toContain('clean');
    expect(badge.getAttribute('aria-label')).toContain('main');
  });

  it('shows modified for a dirty repo', () => {
    render(GitBadge, {
      props: {
        info: { isRepo: true, branch: 'feature/mobile-ux', hasChanges: true },
        state: 'ok',
      },
    });
    const badge = screen.getByTestId('ws-git-badge');
    expect(badge.textContent).toContain('feature/mobile-ux');
    expect(badge.textContent).toContain('modified');
    expect(badge.classList.contains('ws-git--dirty')).toBe(true);
  });

  it('renders nothing for a non-repo', () => {
    const { container } = render(GitBadge, {
      props: { info: { isRepo: false }, state: 'ok' },
    });
    expect(container.querySelector('.ws-git')).toBeNull();
  });

  it('renders nothing while idle/loading (no layout flash)', () => {
    const { container } = render(GitBadge, { props: { info: null, state: 'loading' } });
    expect(container.querySelector('.ws-git')).toBeNull();
  });

  it('shows a subdued unavailable label on error', () => {
    render(GitBadge, { props: { info: null, state: 'error' } });
    expect(screen.getByText('Git unavailable')).toBeTruthy();
  });

  it('handles a missing branch (detached HEAD) without inventing one', () => {
    render(GitBadge, {
      props: { info: { isRepo: true, branch: '', hasChanges: true }, state: 'ok' },
    });
    const badge = screen.getByTestId('ws-git-badge');
    expect(badge.textContent).toContain('modified');
    expect(badge.textContent).not.toContain('main');
  });
});
