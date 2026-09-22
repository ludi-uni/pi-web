<script>
  import { onMount } from 'svelte';
  import SessionCard from '../index/SessionCard.svelte';
  import {
    icon,
    Pin,
    PinOff,
    SquarePen,
    Pencil,
    Trash2,
    Folder,
    MoreHorizontal,
  } from '../../shared/icons.js';
  import { t } from '../../shared/i18n.js';
  import { navigate } from '../../shared/navigation.js';
  import {
    getWorkspaceById,
    renameWorkspace,
    pinWorkspace,
    unpinWorkspace,
    removeWorkspace,
    touchWorkspace,
    createSessionInWorkspace,
    getWorkspaceGitInfo,
  } from '../../index/workspaces.js';
  import GitBadge from './GitBadge.svelte';
  import {
    defaultFetchSessions,
    normalizeSession,
    formatRelativeTime,
  } from '../../index/sessions.js';
  import { fetchModelGroups } from '../../settings/settings-support.js';
  import { updateWorkspaceSettings } from '../../index/workspaces.js';

  let {
    workspaceId = '',
    fetchWorkspace = getWorkspaceById,
    fetchSessions = defaultFetchSessions,
    createSession = createSessionInWorkspace,
    onTouch = touchWorkspace,
  } = $props();

  let workspace = $state(null);
  let sessions = $state([]);
  let loading = $state(true);
  let sessionsLoading = $state(true);
  let notFound = $state(false);
  let loadError = $state('');
  let sessionsError = $state('');
  let busy = $state(false);
  let creatingSession = $state(false);
  let gitInfo = $state(null);
  let gitState = $state('idle'); // idle | loading | ok | error

  // Workspace settings (W4A): model / permissionPreset / quickPrompts.
  // Stored in settings_json; applied to NEW sessions only — existing sessions
  // keep their own model/permissions.
  let settingsOpen = $state(false);
  let settingsBusy = $state(false);
  let modelGroups = $state([]);
  let qpEditing = $state(false);
  let qpDraft = $state([]); // editable quick prompts

  const settings = $derived(workspace?.settings || {});
  const wsModel = $derived(settings.model || '');
  const wsPermission = $derived(settings.permissionPreset || '');
  const wsQuickPrompts = $derived(
    Array.isArray(settings.quickPrompts) ? settings.quickPrompts : null,
  );

  // Model availability: fetched lazily when the workspace has a model preset.
  // 'unknown' until checked, 'available' / 'unavailable' after.
  let modelAvailability = $state('unknown');

  $effect(() => {
    if (!wsModel || modelGroups.length === 0) {
      modelAvailability = 'unknown';
      return;
    }
    const found = modelGroups.some((g) => g.models.some((m) => m.value === wsModel));
    modelAvailability = found ? 'available' : 'unavailable';
  });

  // Fetch model groups when the workspace has a model preset so availability
  // can be shown in the summary without waiting for settings to be opened.
  $effect(() => {
    if (wsModel && modelGroups.length === 0) ensureModelGroups();
  });

  function toggleSettings() {
    settingsOpen = !settingsOpen;
    if (settingsOpen) {
      qpEditing = false;
      qpDraft = wsQuickPrompts ? wsQuickPrompts.map((p) => ({ ...p })) : [];
      ensureModelGroups();
    }
  }

  function ensureModelGroups() {
    if (modelGroups.length > 0) return;
    fetchModelGroups({ fetchImpl: window.fetch.bind(window) })
      .then((g) => (modelGroups = g))
      .catch(() => {});
  }

  async function saveSettings(patch) {
    if (!workspace) return;
    settingsBusy = true;
    loadError = '';
    try {
      await updateWorkspaceSettings(workspace.id, patch);
      await loadWorkspace();
    } catch (err) {
      loadError = err?.message || t('workspaces.updateFailed');
    } finally {
      settingsBusy = false;
    }
  }

  async function setModel(value) {
    await saveSettings({ model: value || null });
  }
  async function setPermission(value) {
    await saveSettings({ permissionPreset: value || null });
  }
  async function saveQuickPrompts() {
    const valid = qpDraft.filter((p) => p.id && p.label && p.prompt);
    await saveSettings({ quickPrompts: valid.length > 0 ? valid : null });
    qpEditing = false;
  }
  function resetQuickPrompts() {
    qpDraft = [];
    saveSettings({ quickPrompts: null });
    qpEditing = false;
  }
  function addQuickPrompt() {
    qpDraft = [...qpDraft, { id: 'qp-' + Date.now().toString(36), label: '', prompt: '' }];
  }
  function removeQuickPrompt(i) {
    qpDraft = qpDraft.filter((_, idx) => idx !== i);
  }

  let menuOpen = $state(false);
  let renaming = $state(false);
  let renameValue = $state('');
  let confirmOpen = $state(false);

  const lastOpened = $derived(
    workspace?.lastOpenedAt ? formatRelativeTime(workspace.lastOpenedAt) : '',
  );

  function toggleMenu(e) {
    e.stopPropagation();
    menuOpen = !menuOpen;
  }
  function closeMenu() {
    menuOpen = false;
  }

  function startRename() {
    renaming = true;
    renameValue = workspace?.name || '';
    menuOpen = false;
    requestAnimationFrame(() => document.getElementById('wsd-rename')?.focus());
  }
  async function commitRename() {
    const name = renameValue.trim();
    renaming = false;
    if (name && workspace && name !== workspace.name) {
      await doAction(() => renameWorkspace(workspace.id, name));
    }
  }
  function cancelRename() {
    renaming = false;
    renameValue = '';
  }

  async function doAction(fn) {
    busy = true;
    loadError = '';
    try {
      await fn();
      await loadWorkspace();
    } catch (err) {
      loadError = err?.message || t('workspaces.updateFailed');
    } finally {
      busy = false;
    }
  }

  async function loadWorkspace() {
    try {
      workspace = await fetchWorkspace(workspaceId);
      notFound = !workspace;
      loadError = '';
    } catch (err) {
      loadError = err?.message || t('workspaces.loadFailed');
      notFound = false;
    } finally {
      loading = false;
    }
  }

  async function loadGit() {
    gitState = 'loading';
    try {
      gitInfo = await getWorkspaceGitInfo(workspace.path);
      gitState = 'ok';
    } catch {
      gitState = 'error';
    }
  }

  async function loadSessions() {
    if (!workspace?.path) {
      sessionsLoading = false;
      return;
    }
    sessionsLoading = true;
    sessionsError = '';
    try {
      // Reuse the existing project filter: workspace.path == session cwd.
      // /api/sessions already returns LastActivity-DESC order.
      const response = await fetchSessions({ project: workspace.path });
      sessions = (response.sessions || []).map(normalizeSession);
    } catch (err) {
      sessionsError = err?.message || t('workspaces.sessionsLoadFailed');
    } finally {
      sessionsLoading = false;
    }
  }

  async function newSession() {
    if (!workspace || creatingSession) return;
    creatingSession = true;
    loadError = '';
    try {
      // Pass the workspace's model preset (if any) as the initial model.
      const model = workspace?.settings?.model || undefined;
      const response = await createSession(workspace.path, { model });
      if (response?.ok && response.id) {
        navigate('/session?id=' + encodeURIComponent(response.id));
        return;
      }
      // Invalid/unavailable workspace model → show the error, don't navigate.
      loadError = response?.error || t('index.failedCreateSession');
    } catch (err) {
      loadError = err?.message || t('index.networkError');
    } finally {
      creatingSession = false;
    }
  }

  async function togglePin() {
    if (!workspace) return;
    await doAction(() =>
      workspace.pinned ? unpinWorkspace(workspace.id) : pinWorkspace(workspace.id),
    );
  }

  function remove() {
    if (!workspace) return;
    confirmOpen = true;
    document.body?.classList.add('modal-sheet-open');
  }

  function closeRemoveConfirm() {
    confirmOpen = false;
    document.body?.classList.remove('modal-sheet-open');
  }

  async function confirmRemove() {
    if (!workspace) return;
    closeRemoveConfirm();
    busy = true;
    try {
      await removeWorkspace(workspace.id);
      navigate('/workspaces');
    } catch (err) {
      loadError = err?.message || t('workspaces.updateFailed');
      busy = false;
    }
  }

  onMount(() => {
    const previousTitle = document.title;
    document.title = t('workspaces.title');
    let cancelled = false;
    (async () => {
      await loadWorkspace();
      if (cancelled) return;
      // Mark the workspace as opened once — after a successful load, not on
      // every reactive update.
      if (workspace) {
        onTouch(workspace.id).catch(() => {});
        loadGit();
        await loadSessions();
      } else {
        sessionsLoading = false;
      }
    })();
    const keydown = (e) => {
      if (e.key === 'Escape' && confirmOpen) closeRemoveConfirm();
      else if (e.key === 'Escape') closeMenu();
    };
    window.addEventListener('keydown', keydown);
    return () => {
      cancelled = true;
      document.title = previousTitle;
      document.body?.classList.remove('modal-sheet-open');
      window.removeEventListener('keydown', keydown);
    };
  });
</script>

<svelte:window onclick={menuOpen ? closeMenu : undefined} />

<!-- eslint-disable svelte/no-at-html-tags -- trusted: Lucide icon SVG from icons.js -->

<div class="session-header-bar">
  <div class="session-header-left">
    <a
      href="/workspaces"
      class="session-header-back"
      onclick={(e) => {
        e.preventDefault();
        navigate('/workspaces');
      }}><span>←</span> {t('workspaces.title')}</a
    >
  </div>
  <span class="session-header-title">{workspace?.name || t('workspaces.title')}</span>
  <div class="session-header-right">
    {#if workspace}
      <button
        type="button"
        class="session-header-new"
        data-testid="wsd-new-session"
        disabled={creatingSession}
        title={t('workspaces.newSession')}
        aria-label={t('workspaces.newSession')}
        onclick={newSession}
        >{@html icon(SquarePen, { size: 14 })}<span class="session-header-new-label"
          >{creatingSession ? t('workspaces.creating') : t('workspaces.newSession')}</span
        ></button
      >
    {/if}
  </div>
</div>

<div class="workspaces-page workspace-detail" data-testid="workspace-detail">
  {#if loadError}
    <p class="ws-error" role="alert">{loadError}</p>
  {/if}

  {#if loading}
    <p class="ws-muted">{t('workspaces.loading')}</p>
  {:else if notFound}
    <div class="ws-empty">
      <p class="ws-empty-title">{t('workspaces.notFound')}</p>
      <p class="ws-muted">{t('workspaces.notFoundHint')}</p>
      <a
        class="ws-btn ws-btn-primary"
        href="/workspaces"
        onclick={(e) => {
          e.preventDefault();
          navigate('/workspaces');
        }}>{t('workspaces.backToList')}</a
      >
    </div>
  {:else if workspace}
    <div class="wsd-header" class:wsd-header--pinned={workspace.pinned}>
      <div class="wsd-title-row">
        <span class="workspace-card-folder" aria-hidden="true"
          >{@html icon(Folder, { size: 18 })}</span
        >
        {#if renaming}
          <input
            id="wsd-rename"
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
          <h1 class="wsd-name" data-testid="wsd-name">{workspace.name}</h1>
        {/if}
        {#if workspace.pinned}
          <span class="workspace-pin-badge" title={t('workspaces.pinned')} aria-hidden="true"
            >{@html icon(Pin, { size: 14 })}</span
          >
        {/if}
      </div>
      <div class="wsd-path" title={workspace.path}><bdi>{workspace.path}</bdi></div>
      <div class="wsd-meta">
        {#if workspace.sessionCount > 0}
          <span>{t('index.sessionsCount', { count: workspace.sessionCount })}</span>
        {/if}
        {#if lastOpened}
          <span>{t('workspaces.lastOpened', { when: lastOpened })}</span>
        {/if}
      </div>
      <div class="wsd-git">
        <GitBadge info={gitInfo} state={gitState} />
      </div>

      <!-- Workspace settings summary (model / permissions / quick prompts) -->
      {#if wsModel || wsPermission || wsQuickPrompts}
        <div class="wsd-presets" data-testid="wsd-presets">
          {#if wsModel}
            <span class="wsd-preset" data-testid="wsd-preset-model">
              {t('workspaces.presetModel')}: <b>{wsModel}</b>
              {#if modelAvailability === 'unavailable'}
                <span class="wsd-preset-warn" data-testid="wsd-model-unavailable"
                  >{t('workspaces.modelUnavailable')}</span
                >
              {/if}
            </span>
          {/if}
          {#if wsPermission}
            <span class="wsd-preset"
              >{t('workspaces.presetPermissions')}: <b>{wsPermission}</b></span
            >
          {/if}
          {#if wsQuickPrompts}
            <span class="wsd-preset"
              >{t('workspaces.presetQuickPrompts')}: <b>{wsQuickPrompts.length}</b></span
            >
          {/if}
        </div>
      {/if}

      <div class="wsd-actions">
        <button
          type="button"
          class="ws-btn ws-btn-primary wsd-new-session-btn"
          disabled={busy || creatingSession}
          onclick={newSession}
        >
          <span class="ws-btn-ico" aria-hidden="true">{@html icon(SquarePen, { size: 14 })}</span>
          <span>{creatingSession ? t('workspaces.creating') : t('workspaces.newSession')}</span>
        </button>
        <button
          type="button"
          class="ws-btn"
          data-testid="wsd-pin"
          disabled={busy}
          aria-label={workspace.pinned ? t('workspaces.unpin') : t('workspaces.pin')}
          aria-pressed={String(!!workspace.pinned)}
          title={workspace.pinned ? t('workspaces.unpin') : t('workspaces.pin')}
          onclick={togglePin}
        >
          <span class="ws-btn-ico" aria-hidden="true"
            >{@html icon(workspace.pinned ? PinOff : Pin, { size: 14 })}</span
          >
        </button>
        <div class="workspace-menu-wrap">
          <button
            type="button"
            class="ws-btn"
            data-testid="wsd-menu"
            disabled={busy}
            aria-label={t('workspaces.actions')}
            aria-haspopup="menu"
            aria-expanded={String(menuOpen)}
            onclick={toggleMenu}
          >
            <span class="ws-btn-ico" aria-hidden="true"
              >{@html icon(MoreHorizontal, { size: 14 })}</span
            >
          </button>
          {#if menuOpen}
            <div class="workspace-menu" role="menu">
              <button
                type="button"
                class="workspace-menu-item"
                role="menuitem"
                onclick={startRename}
              >
                <span class="ws-btn-ico" aria-hidden="true">{@html icon(Pencil, { size: 13 })}</span
                >
                {t('workspaces.rename')}
              </button>
              <button
                type="button"
                class="workspace-menu-item workspace-menu-item--danger"
                role="menuitem"
                onclick={() => {
                  closeMenu();
                  remove();
                }}
              >
                <span class="ws-btn-ico" aria-hidden="true">{@html icon(Trash2, { size: 13 })}</span
                >
                {t('workspaces.remove')}
              </button>
            </div>
          {/if}
        </div>
      </div>
    </div>

    <!-- Workspace Settings (W4A): model / permission / quick-prompt presets.
         Applied to NEW sessions only; existing sessions keep their own. -->
    <div class="wsd-settings" data-testid="wsd-settings">
      <button
        type="button"
        class="wsd-settings-toggle"
        aria-expanded={String(settingsOpen)}
        onclick={toggleSettings}
      >
        <span>{t('workspaces.settingsTitle')}</span>
        <span aria-hidden="true">{settingsOpen ? '▾' : '▸'}</span>
      </button>
      {#if settingsOpen}
        <div class="wsd-settings-body">
          <div class="wsd-field">
            <label class="wsd-field-label" for="wsd-model">{t('workspaces.modelLabel')}</label>
            <select
              id="wsd-model"
              class="wsd-select"
              data-testid="wsd-model"
              value={wsModel}
              disabled={settingsBusy}
              onchange={(e) => setModel(e.currentTarget.value)}
            >
              <option value="">{t('workspaces.useGlobal')}</option>
              {#each modelGroups as group (group.provider)}
                <optgroup label={group.provider}>
                  {#each group.models as option (option.value)}
                    <option value={option.value}>{option.name}</option>
                  {/each}
                </optgroup>
              {/each}
            </select>
            <div class="wsd-field-hint">{t('workspaces.modelHint')}</div>
          </div>

          <div class="wsd-field">
            <label class="wsd-field-label" for="wsd-permission"
              >{t('workspaces.permissionLabel')}</label
            >
            <select
              id="wsd-permission"
              class="wsd-select"
              data-testid="wsd-permission"
              value={wsPermission}
              disabled={settingsBusy}
              onchange={(e) => setPermission(e.currentTarget.value)}
            >
              <option value="">{t('workspaces.useGlobal')}</option>
              <option value="default">{t('workspaces.permissionDefault')}</option>
              <option value="full">{t('workspaces.permissionFull')}</option>
            </select>
            <div class="wsd-field-hint">{t('workspaces.permissionHint')}</div>
          </div>

          <div class="wsd-field">
            <div class="wsd-field-label">{t('workspaces.quickPromptsLabel')}</div>
            {#if qpEditing}
              <div class="wsd-qp-list" data-testid="wsd-qp-list">
                {#each qpDraft as item, i (item.id)}
                  <div class="wsd-qp-row">
                    <input
                      class="wsd-qp-label"
                      type="text"
                      placeholder={t('workspaces.qpLabelPlaceholder')}
                      aria-label={t('workspaces.qpLabelPlaceholder')}
                      bind:value={item.label}
                    />
                    <input
                      class="wsd-qp-prompt"
                      type="text"
                      placeholder={t('workspaces.qpPromptPlaceholder')}
                      aria-label={t('workspaces.qpPromptPlaceholder')}
                      bind:value={item.prompt}
                    />
                    <button
                      type="button"
                      class="ws-btn wsd-qp-remove"
                      aria-label={t('workspaces.qpRemove')}
                      onclick={() => removeQuickPrompt(i)}
                      >{@html icon(Trash2, { size: 13 })}</button
                    >
                  </div>
                {/each}
              </div>
              <div class="wsd-qp-actions">
                <button
                  type="button"
                  class="ws-btn"
                  data-testid="wsd-qp-add"
                  onclick={addQuickPrompt}>{t('workspaces.qpAdd')}</button
                >
                <button
                  type="button"
                  class="ws-btn"
                  data-testid="wsd-qp-reset"
                  onclick={resetQuickPrompts}>{t('workspaces.qpReset')}</button
                >
                <button
                  type="button"
                  class="ws-btn ws-btn-primary"
                  data-testid="wsd-qp-save"
                  disabled={settingsBusy}
                  onclick={saveQuickPrompts}>{t('common.save')}</button
                >
              </div>
            {:else}
              <div class="wsd-qp-summary">
                {#if wsQuickPrompts}
                  <span class="wsd-qp-count"
                    >{t('workspaces.qpCount', { count: wsQuickPrompts.length })}</span
                  >
                {:else}
                  <span class="ws-muted">{t('workspaces.useGlobal')}</span>
                {/if}
                <button
                  type="button"
                  class="ws-btn"
                  data-testid="wsd-qp-edit"
                  onclick={() => (qpEditing = true)}>{t('workspaces.qpEdit')}</button
                >
              </div>
            {/if}
          </div>
        </div>
      {/if}
    </div>

    <div class="wsd-sessions">
      <div class="wsd-sessions-heading">{t('workspaces.recentSessions')}</div>
      {#if sessionsLoading}
        <p class="ws-muted">{t('session.loadingProjectSessions')}</p>
      {:else if sessionsError}
        <p class="ws-error" role="alert">{sessionsError}</p>
      {:else if sessions.length === 0}
        <div class="ws-empty wsd-empty-sessions">
          <p class="ws-empty-title">{t('index.noSessionsYet')}</p>
          <p class="ws-muted">{t('workspaces.emptySessionsHint')}</p>
          <button
            type="button"
            class="ws-btn ws-btn-primary"
            disabled={creatingSession}
            onclick={newSession}
          >
            <span class="ws-btn-ico" aria-hidden="true">{@html icon(SquarePen, { size: 14 })}</span>
            <span>{t('workspaces.newSession')}</span>
          </button>
        </div>
      {:else}
        <div class="session-grid wsd-session-grid" data-testid="wsd-session-list">
          {#each sessions as session (session.id)}
            <SessionCard {session} />
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

{#if confirmOpen && workspace}
  <div
    class="modal-overlay visible open"
    role="presentation"
    onclick={(e) => {
      if (e.currentTarget === e.target) closeRemoveConfirm();
    }}
  >
    <div
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-label={t('workspaces.remove')}
      data-testid="workspace-remove-modal"
    >
      <div class="modal-sheet-header">
        <button
          class="modal-sheet-back"
          type="button"
          aria-label={t('common.close')}
          onclick={closeRemoveConfirm}
        >
          <span aria-hidden="true">←</span>
          <span>{t('workspaces.remove')}</span>
        </button>
      </div>
      <h2>{t('workspaces.remove')}</h2>
      <p class="ws-muted ws-confirm-text">
        {t('workspaces.confirmRemove', { name: workspace.name })}
      </p>
      <div class="modal-actions">
        <button class="btn-secondary" type="button" onclick={closeRemoveConfirm}
          >{t('common.cancel')}</button
        >
        <button
          class="btn-primary ws-btn-danger"
          type="button"
          data-testid="workspace-remove-confirm"
          disabled={busy}
          onclick={confirmRemove}>{t('workspaces.remove')}</button
        >
      </div>
    </div>
  </div>
{/if}
