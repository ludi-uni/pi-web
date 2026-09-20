<script>
  import { icon, Folder, ChevronRight } from '../../shared/icons.js';
  import { t } from '../../shared/i18n.js';
  import { navigate, handleNavClick } from '../../shared/navigation.js';
  import { createSessionInWorkspace } from '../../index/workspaces.js';

  let {
    workspaces = [],
    createSession = createSessionInWorkspace,
    onNewSession = () => {},
  } = $props();

  let creatingFor = $state('');

  const pinnedWorkspaces = $derived(workspaces.filter((w) => w.pinned));
  const hasPinned = $derived(pinnedWorkspaces.length > 0);

  async function quickStart(workspace) {
    if (creatingFor) return;
    creatingFor = workspace.id;
    try {
      const model = workspace?.settings?.model || undefined;
      const response = await createSession(workspace.path, { model });
      if (response?.ok && response.id) {
        navigate('/session?id=' + encodeURIComponent(response.id));
        return;
      }
    } catch {
      // Fall through to the generic new-session modal on failure.
    } finally {
      creatingFor = '';
    }
    onNewSession(workspace.path);
  }
</script>

<!-- eslint-disable svelte/no-at-html-tags -- trusted: Lucide icon SVG from icons.js -->

{#if hasPinned}
  <div class="workspace-quick-access" data-testid="workspace-quick-access">
    <div class="workspace-quick-access-header">
      <span class="workspace-quick-access-label">{t('workspaces.quickAccess')}</span>
      <a
        class="workspace-quick-access-link"
        href="/workspaces"
        onclick={(e) => handleNavClick(e, '/workspaces')}
      >
        {t('workspaces.browseAll')}
        <span class="ws-btn-ico" aria-hidden="true">{@html icon(ChevronRight, { size: 12 })}</span>
      </a>
    </div>
    <div class="workspace-quick-access-list">
      {#each pinnedWorkspaces as workspace (workspace.id)}
        <button
          type="button"
          class="workspace-quick-chip"
          data-testid="workspace-quick-chip"
          disabled={creatingFor === workspace.id}
          onclick={() => quickStart(workspace)}
        >
          <span class="workspace-quick-chip-icon" aria-hidden="true"
            >{@html icon(Folder, { size: 14 })}</span
          >
          <span class="workspace-quick-chip-name">{workspace.name}</span>
          {#if creatingFor === workspace.id}
            <span class="workspace-quick-chip-loading">{t('workspaces.creating')}</span>
          {/if}
        </button>
      {/each}
    </div>
  </div>
{/if}
