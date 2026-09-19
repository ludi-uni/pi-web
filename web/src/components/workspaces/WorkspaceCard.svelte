<script>
  import { icon, Pin, PinOff, SquarePen, Pencil, Trash2, Folder } from '../../shared/icons.js';
  import { t } from '../../shared/i18n.js';
  import { formatRelativeTime } from '../../index/sessions.js';
  import { handleNavClick } from '../../shared/navigation.js';
  import GitBadge from './GitBadge.svelte';

  let {
    workspace = {},
    busy = false,
    creatingSession = false,
    gitInfo = null,
    gitState = 'idle',
    onNewSession = () => {},
    onTogglePin = () => {},
    onRename = () => {},
    onRemove = () => {},
  } = $props();

  let menuOpen = $state(false);
  let renaming = $state(false);
  let renameValue = $state('');

  const lastOpened = $derived(
    workspace.lastOpenedAt ? formatRelativeTime(workspace.lastOpenedAt) : '',
  );

  function startRename() {
    renaming = true;
    renameValue = workspace.name;
    menuOpen = false;
    requestAnimationFrame(() => document.getElementById(`ws-rename-${workspace.id}`)?.focus());
  }

  async function commitRename() {
    const name = renameValue.trim();
    if (name && name !== workspace.name) {
      await onRename(workspace, name);
    }
    renaming = false;
  }

  function cancelRename() {
    renaming = false;
    renameValue = '';
  }

  function toggleMenu(e) {
    e.stopPropagation();
    menuOpen = !menuOpen;
  }

  function closeMenu() {
    menuOpen = false;
  }

  const detailHref = $derived(`/workspace?id=${encodeURIComponent(workspace.id || '')}`);
</script>

<svelte:window onclick={menuOpen ? closeMenu : undefined} />

<!-- eslint-disable svelte/no-at-html-tags -- trusted: Lucide icon SVG from icons.js -->

<li
  class="workspace-card"
  class:workspace-card--pinned={workspace.pinned}
  data-workspace-id={workspace.id}
  data-testid="workspace-card"
>
  <div class="workspace-card-main">
    <div class="workspace-card-title-row">
      <span class="workspace-card-folder" aria-hidden="true"
        >{@html icon(Folder, { size: 15 })}</span
      >
      {#if renaming}
        <input
          id="ws-rename-{workspace.id}"
          class="workspace-rename-input"
          type="text"
          bind:value={renameValue}
          disabled={busy}
          aria-label={t('workspaces.renameLabel')}
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitRename();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              cancelRename();
            }
          }}
          onblur={cancelRename}
        />
      {:else}
        <a
          class="workspace-card-name"
          data-testid="workspace-name"
          href={detailHref}
          aria-label={t('workspaces.openWorkspace', { name: workspace.name })}
          onclick={(e) => {
            e.stopPropagation();
            handleNavClick(e, detailHref);
          }}>{workspace.name}</a
        >
      {/if}
      {#if workspace.pinned}
        <span class="workspace-pin-badge" title={t('workspaces.pinned')} aria-hidden="true"
          >{@html icon(Pin, { size: 12 })}</span
        >
      {/if}
    </div>
    <div class="workspace-card-path" title={workspace.path}><bdi>{workspace.path}</bdi></div>
    <div class="workspace-card-meta">
      <GitBadge info={gitInfo} state={gitState} />
      {#if workspace.sessionCount > 0}
        <span class="workspace-card-sessions"
          >{t('index.sessionsCount', { count: workspace.sessionCount })}</span
        >
      {/if}
      {#if lastOpened}
        <span class="workspace-card-last-opened"
          >{t('workspaces.lastOpened', { when: lastOpened })}</span
        >
      {/if}
    </div>
  </div>

  <div class="workspace-card-actions">
    <button
      type="button"
      class="ws-btn ws-btn-primary workspace-new-session"
      data-testid="workspace-new-session"
      disabled={busy || creatingSession}
      onclick={(e) => {
        e.stopPropagation();
        onNewSession(workspace);
      }}
    >
      <span class="ws-btn-ico" aria-hidden="true">{@html icon(SquarePen, { size: 14 })}</span>
      <span>{creatingSession ? t('workspaces.creating') : t('workspaces.newSession')}</span>
    </button>
    <button
      type="button"
      class="ws-btn workspace-pin-btn"
      data-testid="workspace-pin"
      disabled={busy}
      aria-label={workspace.pinned ? t('workspaces.unpin') : t('workspaces.pin')}
      aria-pressed={String(!!workspace.pinned)}
      title={workspace.pinned ? t('workspaces.unpin') : t('workspaces.pin')}
      onclick={(e) => {
        e.stopPropagation();
        onTogglePin(workspace);
      }}
    >
      <span class="ws-btn-ico" aria-hidden="true"
        >{@html icon(workspace.pinned ? PinOff : Pin, { size: 14 })}</span
      >
    </button>
    <div class="workspace-menu-wrap">
      <button
        type="button"
        class="ws-btn workspace-menu-btn"
        data-testid="workspace-menu"
        disabled={busy}
        aria-label={t('workspaces.actions')}
        aria-haspopup="menu"
        aria-expanded={String(menuOpen)}
        onclick={(e) => {
          e.stopPropagation();
          toggleMenu(e);
        }}
      >
        <span class="ws-btn-ico" aria-hidden="true">{@html icon(Pencil, { size: 14 })}</span>
      </button>
      {#if menuOpen}
        <div class="workspace-menu" role="menu">
          <button
            type="button"
            class="workspace-menu-item"
            role="menuitem"
            onclick={(e) => {
              e.stopPropagation();
              startRename();
            }}
          >
            <span class="ws-btn-ico" aria-hidden="true">{@html icon(Pencil, { size: 13 })}</span>
            {t('workspaces.rename')}
          </button>
          <button
            type="button"
            class="workspace-menu-item workspace-menu-item--danger"
            role="menuitem"
            onclick={(e) => {
              e.stopPropagation();
              closeMenu();
              onRemove(workspace);
            }}
          >
            <span class="ws-btn-ico" aria-hidden="true">{@html icon(Trash2, { size: 13 })}</span>
            {t('workspaces.remove')}
          </button>
        </div>
      {/if}
    </div>
  </div>
</li>
