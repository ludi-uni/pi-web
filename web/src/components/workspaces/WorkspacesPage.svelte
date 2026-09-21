<script>
  import { onMount } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import WorkspaceCard from './WorkspaceCard.svelte';
  import { icon, Folder, FolderOpen, Plus } from '../../shared/icons.js';
  import { t } from '../../shared/i18n.js';
  import { navigate } from '../../shared/navigation.js';
  import {
    loadWorkspaces,
    createWorkspace,
    renameWorkspace,
    pinWorkspace,
    unpinWorkspace,
    removeWorkspace,
    touchWorkspace,
    createSessionInWorkspace,
    getWorkspaceGitInfo,
    browseDirs as apiBrowseDirs,
  } from '../../index/workspaces.js';
  import { defaultFetchRecent, defaultFetchProjects } from '../../index/sessions.js';

  let {
    fetchWorkspaces = loadWorkspaces,
    fetchRecent = defaultFetchRecent,
    fetchProjects = defaultFetchProjects,
    createSession = createSessionInWorkspace,
    fetchDirs = apiBrowseDirs,
  } = $props();

  let workspaces = $state([]);
  let loading = $state(true);
  let loadError = $state('');
  let busy = $state(false);
  let creatingFor = $state(''); // workspace id with an in-flight New Session

  // Per-workspace git info. Fetched once per workspace when its card mounts,
  // bounded by a small concurrency limit so a long list doesn't spawn dozens
  // of git processes simultaneously. Keyed by workspace id.
  let gitInfo = $state({}); // id -> info object
  let gitState = $state({}); // id -> 'loading' | 'ok' | 'error'
  const gitRequested = new SvelteSet(); // ids already fetched
  const GIT_CONCURRENCY = 4;
  let gitInFlight = 0;
  const gitQueue = [];

  function queueGit(id) {
    if (gitRequested.has(id)) return;
    gitRequested.add(id);
    gitQueue.push(id);
    drainGitQueue();
  }

  async function drainGitQueue() {
    while (gitInFlight < GIT_CONCURRENCY && gitQueue.length > 0) {
      const id = gitQueue.shift();
      const ws = workspaces.find((w) => w.id === id);
      if (!ws) continue;
      gitInFlight++;
      gitState = { ...gitState, [id]: 'loading' };
      getWorkspaceGitInfo(ws.path)
        .then((info) => {
          gitInfo = { ...gitInfo, [id]: info };
          gitState = { ...gitState, [id]: 'ok' };
        })
        .catch(() => {
          gitState = { ...gitState, [id]: 'error' };
        })
        .finally(() => {
          gitInFlight--;
          drainGitQueue();
        });
    }
  }

  // Svelte action: queue a git fetch when the card mounts.
  function observeGit(node, id) {
    queueGit(id);
    return {};
  }

  // Add Workspace sheet state.
  let addOpen = $state(false);
  let addPath = $state('');
  let addName = $state('');
  let addError = $state('');
  let suggestions = $state([]);

  // Folder browser state. `browsePath` is the directory currently being
  // listed; `browseDirs` are its immediate subdirectories. Empty browsePath
  // means the platform root (drive list on Windows, home elsewhere).
  let browseOpen = $state(false);
  let browsePath = $state('');
  let browseParent = $state('');
  let browseEntries = $state([]);
  let browseLoading = $state(false);
  let browseError = $state('');

  async function loadDirs(path) {
    browseLoading = true;
    browseError = '';
    try {
      const res = await fetchDirs(path || '');
      browsePath = res.path || '';
      browseParent = res.parent || '';
      browseEntries = Array.isArray(res.dirs) ? res.dirs : [];
    } catch (err) {
      browseError = err?.message || t('workspaces.browseFailed');
    } finally {
      browseLoading = false;
    }
  }

  function openBrowser() {
    browseOpen = true;
    // Seed the browser at the typed path when it is non-empty — handy when the
    // user already pasted a parent directory.
    loadDirs(addPath.trim());
  }

  function joinBrowsePath(dir) {
    if (!browsePath) return dir; // drive roots arrive already qualified
    const sep = browsePath.includes('\\') || /^[A-Za-z]:/.test(browsePath) ? '\\' : '/';
    const base = browsePath.endsWith(sep) ? browsePath : browsePath + sep;
    return base + dir;
  }

  function pickBrowseDir(dir) {
    loadDirs(joinBrowsePath(dir));
  }

  function selectBrowseDir() {
    if (browsePath) addPath = browsePath;
    browseOpen = false;
  }

  async function refresh() {
    try {
      workspaces = await fetchWorkspaces();
      loadError = '';
    } catch (err) {
      loadError = err?.message || t('workspaces.loadFailed');
    } finally {
      loading = false;
    }
  }

  async function workspaceAction(fn) {
    busy = true;
    try {
      await fn();
      await refresh();
    } catch (err) {
      loadError = err?.message || t('workspaces.updateFailed');
    } finally {
      busy = false;
    }
  }

  async function openAdd() {
    addOpen = true;
    addPath = '';
    addName = '';
    addError = '';
    document.body?.classList.add('modal-sheet-open');
    // Suggested workspaces: known project paths + recent locations that are
    // not yet registered. Suggestions only — nothing is auto-registered.
    try {
      const [projectsRes, recentRes] = await Promise.all([
        fetchProjects().catch(() => ({ projects: [] })),
        fetchRecent().catch(() => ({ locations: [] })),
      ]);
      // Compare on a lightly-normalized key so a registered workspace isn't
      // re-suggested when the same path arrives with different separators or
      // a trailing slash. The backend applies filepath.Clean at create time;
      // here we only need enough normalization for display filtering.
      const key = (p) =>
        String(p || '')
          .trim()
          .replace(/\\/g, '/')
          .replace(/\/+$/, '')
          .toLowerCase();
      const seen = new SvelteSet(workspaces.map((w) => key(w.path)));
      const candidates = [];
      for (const p of [...(projectsRes.projects || []), ...(recentRes.locations || [])]) {
        const raw = typeof p === 'string' ? p : p?.path;
        if (raw && !seen.has(key(raw))) {
          seen.add(key(raw));
          candidates.push(raw);
        }
      }
      suggestions = candidates.slice(0, 8);
    } catch {
      suggestions = [];
    }
  }

  function closeAdd() {
    addOpen = false;
    browseOpen = false;
    document.body?.classList.remove('modal-sheet-open');
  }

  async function submitAdd(pathOverride) {
    const path = (pathOverride ?? addPath).trim();
    if (!path) {
      addError = t('index.enterPath');
      return;
    }
    busy = true;
    addError = '';
    try {
      await createWorkspace(path, addName.trim());
      closeAdd();
      await refresh();
    } catch (err) {
      addError = err?.message || t('workspaces.createFailed');
    } finally {
      busy = false;
    }
  }

  async function newSession(workspace) {
    if (creatingFor) return;
    creatingFor = workspace.id;
    loadError = '';
    try {
      // Pass the workspace's model preset (if any) as the initial model.
      const model = workspace?.settings?.model || undefined;
      const response = await createSession(workspace.path, { model });
      if (response?.ok && response.id) {
        // Touch after a successful create: last-opened reflects a session the
        // user actually entered, not a failed attempt.
        touchWorkspace(workspace.id).catch(() => {});
        navigate('/session?id=' + encodeURIComponent(response.id));
        return;
      }
      loadError = response?.error || t('index.failedCreateSession');
    } catch (err) {
      loadError = err?.message || t('index.networkError');
    } finally {
      creatingFor = '';
    }
  }

  async function togglePin(workspace) {
    await workspaceAction(() =>
      workspace.pinned ? unpinWorkspace(workspace.id) : pinWorkspace(workspace.id),
    );
  }

  async function rename(workspace, name) {
    await workspaceAction(() => renameWorkspace(workspace.id, name));
  }

  async function remove(workspace) {
    if (
      typeof window !== 'undefined' &&
      !window.confirm(t('workspaces.confirmRemove', { name: workspace.name }))
    ) {
      return;
    }
    await workspaceAction(() => removeWorkspace(workspace.id));
  }

  const backHref =
    typeof window !== 'undefined' && typeof window.history.state?.back === 'string'
      ? window.history.state.back
      : '/';

  onMount(() => {
    const previousTitle = document.title;
    document.title = t('workspaces.title');
    refresh();
    const keydown = (e) => {
      if (e.key === 'Escape' && addOpen) closeAdd();
    };
    window.addEventListener('keydown', keydown);
    return () => {
      document.title = previousTitle;
      document.body?.classList.remove('modal-sheet-open');
      window.removeEventListener('keydown', keydown);
    };
  });
</script>

<!-- eslint-disable svelte/no-at-html-tags -- trusted: Lucide icon SVG from icons.js -->

<div class="session-header-bar">
  <div class="session-header-left">
    <a
      href={backHref}
      class="session-header-back"
      onclick={(e) => {
        e.preventDefault();
        navigate(backHref);
      }}><span>←</span> {backHref === '/' ? t('session.back') : t('common.back')}</a
    >
  </div>
  <span class="session-header-title">{t('workspaces.title')}</span>
  <div class="session-header-right">
    <button
      type="button"
      class="session-header-new workspaces-header-new"
      data-testid="workspace-add"
      title={t('workspaces.add')}
      aria-label={t('workspaces.add')}
      onclick={openAdd}
      >{@html icon(Plus, { size: 14 })}<span class="session-header-new-label"
        >{t('workspaces.add')}</span
      ></button
    >
  </div>
</div>

<div class="workspaces-page">
  {#if loadError}
    <p class="ws-error" role="alert">{loadError}</p>
  {/if}

  {#if loading}
    <p class="ws-muted">{t('workspaces.loading')}</p>
  {:else if workspaces.length === 0}
    <div class="ws-empty">
      <p class="ws-empty-title">{t('workspaces.emptyTitle')}</p>
      <p class="ws-muted">{t('workspaces.emptyHint')}</p>
      <button
        type="button"
        class="ws-btn ws-btn-primary"
        data-testid="workspace-add-empty"
        onclick={openAdd}
      >
        <span class="ws-btn-ico" aria-hidden="true">{@html icon(Plus, { size: 15 })}</span>
        <span>{t('workspaces.add')}</span>
      </button>
    </div>
  {:else}
    <ul class="workspace-list" data-testid="workspace-list">
      {#each workspaces as workspace (workspace.id)}
        <div use:observeGit={workspace.id} class="workspace-card-observer">
          <WorkspaceCard
            {workspace}
            {busy}
            creatingSession={creatingFor === workspace.id}
            gitInfo={gitInfo[workspace.id]}
            gitState={gitState[workspace.id] || 'idle'}
            onNewSession={newSession}
            onTogglePin={togglePin}
            onRename={rename}
            onRemove={remove}
          />
        </div>
      {/each}
    </ul>
  {/if}
</div>

<!-- Floating add button on mobile, mirroring the schedules page. -->
<button
  type="button"
  class="new-session-btn new-session-btn-mobile ws-fab"
  data-testid="workspace-add-fab"
  aria-label={t('workspaces.add')}
  onclick={openAdd}>+</button
>

{#if addOpen}
  <div
    class="modal-overlay visible open"
    id="workspaceAddOverlay"
    role="presentation"
    onclick={(e) => {
      if (e.currentTarget === e.target) closeAdd();
    }}
  >
    <div class="modal" role="dialog" aria-modal="true" aria-label={t('workspaces.addTitle')}>
      <div class="modal-sheet-header">
        <button
          class="modal-sheet-back"
          type="button"
          aria-label={t('workspaces.closeAdd')}
          onclick={closeAdd}
        >
          <span aria-hidden="true">←</span>
          <span>{t('workspaces.addTitle')}</span>
        </button>
      </div>
      <h2>{t('workspaces.addTitle')}</h2>

      {#if suggestions.length > 0}
        <div class="ws-suggestions" data-testid="workspace-suggestions">
          <div class="ws-suggestions-label">{t('workspaces.suggested')}</div>
          {#each suggestions as path (path)}
            <button
              type="button"
              class="ws-suggestion-chip"
              disabled={busy}
              onclick={() => submitAdd(path)}><bdi>{path}</bdi></button
            >
          {/each}
        </div>
      {/if}

      <label class="ws-field-label" for="workspacePath">{t('workspaces.pathLabel')}</label>
      <div class="ws-path-row">
        <input
          type="text"
          id="workspacePath"
          placeholder={t('index.sessionPathPlaceholder')}
          bind:value={addPath}
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submitAdd();
            }
          }}
        />
        <button
          type="button"
          class="btn-secondary ws-browse-btn"
          data-testid="workspace-browse"
          onclick={openBrowser}
        >
          <span class="ws-btn-ico" aria-hidden="true">{@html icon(FolderOpen, { size: 14 })}</span>
          <span>{t('workspaces.browse')}</span>
        </button>
      </div>
      {#if browseOpen}
        <div class="ws-browser" data-testid="workspace-browser">
          <div class="ws-browser-head">
            {#if browsePath}
              <button
                type="button"
                class="ws-browser-up"
                data-testid="workspace-browse-up"
                onclick={() => loadDirs(browseParent)}
                disabled={browseLoading}
              >
                {t('workspaces.browseUp')}
              </button>
            {/if}
            <span class="ws-browser-path"
              ><bdi>{browsePath || t('workspaces.browseRoot')}</bdi></span
            >
          </div>
          {#if browseError}
            <p class="ws-error" role="alert">{browseError}</p>
          {:else if browseLoading}
            <p class="ws-muted">{t('workspaces.browseLoading')}</p>
          {:else if browseEntries.length === 0}
            <p class="ws-muted">{t('workspaces.browseEmpty')}</p>
          {:else}
            <ul class="ws-browser-list">
              {#each browseEntries as dir (dir)}
                <li>
                  <button type="button" class="ws-browser-dir" onclick={() => pickBrowseDir(dir)}>
                    <span class="ws-btn-ico" aria-hidden="true"
                      >{@html icon(Folder, { size: 14 })}</span
                    >
                    <bdi>{dir}</bdi>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
          <div class="ws-browser-actions">
            <button
              type="button"
              class="btn-secondary"
              data-testid="workspace-browse-select"
              disabled={!browsePath}
              onclick={selectBrowseDir}>{t('workspaces.browseSelect')}</button
            >
          </div>
        </div>
      {/if}
      <label class="ws-field-label" for="workspaceName">{t('workspaces.nameLabel')}</label>
      <input
        type="text"
        id="workspaceName"
        placeholder={t('workspaces.namePlaceholder')}
        bind:value={addName}
        onkeydown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submitAdd();
          }
        }}
      />
      <div class="modal-error" role="alert">{addError}</div>
      <div class="modal-actions">
        <button class="btn-secondary" type="button" onclick={closeAdd}>{t('common.cancel')}</button>
        <button
          class="btn-primary"
          type="button"
          data-testid="workspace-add-submit"
          disabled={busy || !addPath.trim()}
          onclick={() => submitAdd()}>{t('common.add')}</button
        >
      </div>
    </div>
  </div>
{/if}
