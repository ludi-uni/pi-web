<script>
  import { onMount } from 'svelte';
  import { icon, Folder, ChevronRight } from '../../shared/icons.js';
  import { t } from '../../shared/i18n.js';
  import { handleNavClick } from '../../shared/navigation.js';

  let { workspaces = [] } = $props();

  // On narrow screens the chip grid renders 2-per-row, so a long workspace
  // list would push the Inbox and session list far down. Cap the visible
  // chips on mobile; the trailing "view all" chip leads to /workspaces.
  const MOBILE_CHIP_LIMIT = 6;
  let isMobile = $state(false);
  onMount(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(max-width: 900px)');
    const sync = () => (isMobile = mql.matches);
    sync();
    mql.addEventListener('change', sync);
    return () => mql.removeEventListener('change', sync);
  });

  const sortedWorkspaces = $derived(
    [...workspaces].sort((a, b) => {
      if (a.pinned !== b.pinned) return b.pinned - a.pinned;
      const aTime = Date.parse(a.lastOpenedAt || '') || 0;
      const bTime = Date.parse(b.lastOpenedAt || '') || 0;
      if (aTime !== bTime) return bTime - aTime;
      return (a.name || '').localeCompare(b.name || '');
    }),
  );
  const hasWorkspaces = $derived(sortedWorkspaces.length > 0);
  const visibleWorkspaces = $derived(
    isMobile ? sortedWorkspaces.slice(0, MOBILE_CHIP_LIMIT) : sortedWorkspaces,
  );
  const hiddenCount = $derived(sortedWorkspaces.length - visibleWorkspaces.length);

  function openWorkspace(workspace, event) {
    handleNavClick(event, `/workspace?id=${encodeURIComponent(workspace.id || '')}`);
  }
</script>

<!-- eslint-disable svelte/no-at-html-tags -- trusted: Lucide icon SVG from icons.js -->

{#if hasWorkspaces}
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
      {#each visibleWorkspaces as workspace (workspace.id)}
        <button
          type="button"
          class="workspace-quick-chip"
          class:workspace-quick-chip--pinned={workspace.pinned}
          data-testid="workspace-quick-chip"
          onclick={(e) => openWorkspace(workspace, e)}
        >
          <span class="workspace-quick-chip-icon" aria-hidden="true"
            >{@html icon(Folder, { size: 14 })}</span
          >
          <span class="workspace-quick-chip-name">{workspace.name}</span>
          {#if workspace.sessionCount > 0}
            <span class="workspace-quick-chip-count">{workspace.sessionCount}</span>
          {/if}
        </button>
      {/each}
      {#if hiddenCount > 0}
        <a
          class="workspace-quick-chip workspace-quick-chip--more"
          href="/workspaces"
          data-testid="workspace-quick-more"
          onclick={(e) => handleNavClick(e, '/workspaces')}
        >
          <span class="workspace-quick-chip-icon" aria-hidden="true"
            >{@html icon(ChevronRight, { size: 14 })}</span
          >
          <span class="workspace-quick-chip-name"
            >{t('workspaces.viewAll', { count: sortedWorkspaces.length })}</span
          >
        </a>
      {/if}
    </div>
  </div>
{/if}
