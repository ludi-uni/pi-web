<script>
  import { t } from '../../shared/i18n.js';

  // Compact, non-interactive git status badge for a workspace.
  // `info` is the /api/git/info response ({isRepo, branch, hasChanges, …}).
  // `state` is 'idle' | 'loading' | 'ok' | 'error' — the parent owns fetching.
  // Non-repo and error render nothing (or a subdued label), never a big panel.
  let { info = null, state = 'idle' } = $props();

  const isRepo = $derived(!!info?.isRepo);
  const branch = $derived(info?.branch || '');
  const dirty = $derived(!!info?.hasChanges);
</script>

{#if state === 'error'}
  <span class="ws-git ws-git--unavailable" role="note">{t('workspaces.gitUnavailable')}</span>
{:else if isRepo}
  <span
    class="ws-git"
    class:ws-git--dirty={dirty}
    data-testid="ws-git-badge"
    aria-label={branch
      ? t('workspaces.gitStatus', {
          branch,
          status: dirty ? t('workspaces.modified') : t('workspaces.clean'),
        })
      : t('workspaces.gitRepo')}
  >
    {#if branch}
      <span class="ws-git-branch" title={branch}>{branch}</span>
      <span class="ws-git-sep" aria-hidden="true">·</span>
    {/if}
    <span class="ws-git-status">{dirty ? t('workspaces.modified') : t('workspaces.clean')}</span>
  </span>
{/if}
