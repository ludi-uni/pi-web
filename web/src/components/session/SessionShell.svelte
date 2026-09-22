<script>
  import ChatComposer from './ChatComposer.svelte';
  import LiveReload from './LiveReload.svelte';
  import CommandMenu from './CommandMenu.svelte';
  import RightSidebar from './RightSidebar.svelte';
  import SessionHeader from './SessionHeader.svelte';
  import SessionInfoHeader from './SessionInfoHeader.svelte';
  import SessionContent from './SessionContent.svelte';
  import ImageModal from './ImageModal.svelte';
  import ShortcutsModal from './ShortcutsModal.svelte';
  import ModelUsageModal from './ModelUsageModal.svelte';
  import ForkModal from './ForkModal.svelte';
  import CatGatekeeperSettings from './CatGatekeeperSettings.svelte';
  import CatGatekeeper from './CatGatekeeper.svelte';
  import BtwPopup from './BtwPopup.svelte';
  import LabelModal from './LabelModal.svelte';
  import RenameModal from './RenameModal.svelte';
  import DiffModal from './DiffModal.svelte';
  import ResultCard from './ResultCard.svelte';
  import ApprovalCard from './ApprovalCard.svelte';
  import {
    approvalsForSession,
    subscribeApprovals,
    resetApprovals,
    seedApprovals,
  } from '../../session/approval/approval-store.js';
  import LoadEarlier from './LoadEarlier.svelte';
  import SessionTree from './SessionTree.svelte';
  import ShareDialog from './ShareDialog.svelte';
  import ProjectsModal from '../index/ProjectsModal.svelte';
  import NewSessionModal from '../index/NewSessionModal.svelte';
  import {
    defaultFetchProjects,
    defaultUpdateProject,
    defaultFetchRecent,
    defaultCreateSession,
  } from '../../index/sessions.js';
  import { loadWorkspaces } from '../../index/workspaces.js';
  import { t } from '../../shared/i18n.js';
  import { navigate } from '../../shared/navigation.js';
  import {
    sessionModals,
    hasDiffUrlParam,
    syncDiffUrlParam,
  } from '../../session/session-modals.svelte.js';
  import { getSessionRuntime } from '../../session/session-runtime-context.js';
  import { onMount } from 'svelte';
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import { createAnnotationApi } from '../../session/annotations/annotation-api.js';
  import { createStatusEvents } from '../../shared/status-events.js';
  import { sessionRuntime } from '../../session/session-runtime.js';

  let {
    sessionModel,
    contentRuntime,
    sessionId = '',
    sessionUUID = '',
    title = 'Session',
    scratchpad = '',
    cwd = '',
    chatAvailable = true,
    chatDisabledReason = '',
    modelLabel = '',
    freshPrefetch = false,
    dataEl = $bindable(null),
  } = $props();

  // Manage-projects sheet, opened from the header. Enabling/disabling a project
  // changes what the sidebar's PROJECTS tab lists, so every successful update
  // bumps projectsRevision, which remounts <SessionSidebarProjects>.
  let projects = $state([]);
  let projectsFilterEnabled = $state(false);
  let projectsBusy = $state(false);
  let projectsError = $state('');
  let projectsRevision = $state(0);

  // "New session (choose folder)" sheet — same modal the index uses, so the
  // operator can start a session in another project without going back to the
  // index first.
  let newSessionPath = $state('');
  let newSessionRecent = $state([]);
  let newSessionWorkspaces = $state([]);
  let newSessionCreating = $state(false);
  let newSessionError = $state('');

  async function refreshProjectsList() {
    projectsError = '';
    projectsBusy = true;
    try {
      const response = await defaultFetchProjects();
      projects = Array.isArray(response.projects) ? response.projects : [];
      projectsFilterEnabled = !!response.filterEnabled;
    } catch (error) {
      projectsError = error.message || t('index.failedLoadProjects');
    } finally {
      projectsBusy = false;
    }
  }

  async function updateProject(path, action) {
    projectsBusy = true;
    projectsError = '';
    try {
      await defaultUpdateProject(path, action);
      projectsRevision += 1;
      await refreshProjectsList();
    } catch (error) {
      projectsError = error.message || t('index.failedUpdateProject');
    } finally {
      projectsBusy = false;
    }
  }

  $effect(() => {
    if (!sessionModals.newSession) return;
    newSessionPath = '';
    newSessionError = '';
    document.body.classList.add('modal-sheet-open');
    defaultFetchRecent()
      .then((r) => (newSessionRecent = (r.locations || []).slice(0, 10)))
      .catch(() => (newSessionRecent = []));
    loadWorkspaces()
      .then((list) => (newSessionWorkspaces = list))
      .catch(() => (newSessionWorkspaces = []));
    return () => document.body.classList.remove('modal-sheet-open');
  });

  async function createNewSession() {
    const path = newSessionPath.trim();
    if (!path) {
      newSessionError = t('index.enterPath');
      return;
    }
    newSessionCreating = true;
    newSessionError = '';
    try {
      const response = await defaultCreateSession(path);
      if (response?.ok && response.id) {
        sessionModals.newSession = false;
        navigate('/session?id=' + encodeURIComponent(response.id));
        return;
      }
      newSessionError = response?.error || t('index.failedCreateSession');
    } catch (err) {
      newSessionError = err?.message || t('index.networkError');
    } finally {
      newSessionCreating = false;
    }
  }

  $effect(() => {
    if (!sessionModals.projects) return;
    document.body.classList.add('modal-sheet-open');
    refreshProjectsList();
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      sessionModals.projects = false;
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => {
      document.body.classList.remove('modal-sheet-open');
      window.removeEventListener('keydown', onKey, { capture: true });
    };
  });

  // Pending approvals for this session (future approval flow). Empty until a
  // real approval_required event arrives — ApprovalCard stays unmounted in
  // production until then. Re-rendered via the approval-store subscription.
  let pendingApprovals = $state([]);
  onMount(() => {
    const sync = () => (pendingApprovals = approvalsForSession(sessionId));
    sync();
    // Seed from the server so an approval that fired before the SSE listener
    // attached is still shown. Re-seed on each session reload too — a gated
    // prompt writes entries (firing a reload) around the same time the
    // approval SSE lands, so this closes the race deterministically.
    const reseed = () => seedApprovals(sessionId).then(sync);
    reseed();
    window.addEventListener('pi-session-reload', reseed);
    const unsub = subscribeApprovals(sync);
    return () => {
      unsub();
      resetApprovals();
      window.removeEventListener('pi-session-reload', reseed);
    };
  });

  const runtime = getSessionRuntime();
  const runningSessionIds = new SvelteSet();
  const runningSessionProjects = new SvelteMap();

  // Annotation config, supplied as props to <AnnotationLayer> (via <RightSidebar>)
  // instead of the former imperative init() up-call. The DOM anchors are resolved
  // after mount; the callbacks route through the shared session runtime.
  let annotationScopes = $state([]);
  let annotationComposer = $state(null);
  let annotationCountEl = $state(null);

  const annotationApi = $derived(
    sessionId ? createAnnotationApi({ sessionId, fetchImpl: window.fetch.bind(window) }) : null,
  );

  const annotationConfig = $derived({
    api: annotationApi,
    scopes: annotationScopes,
    composerEl: annotationComposer,
    countEl: annotationCountEl,
    onSelectArtifact: (artifactId) => {
      sessionRuntime.rightSidebar?.activateTab('artifacts');
      sessionRuntime.artifacts?.selectArtifact(artifactId);
    },
    onCreate: () => {
      sessionRuntime.rightSidebar?.open();
      sessionRuntime.rightSidebar?.activateTab('notes');
    },
    onSend: () => {
      if (sessionRuntime.layout?.isMobileLayout?.()) sessionRuntime.rightSidebar?.collapse();
    },
    onAddToChat: (attachment) => {
      window.dispatchEvent(new CustomEvent('pi-chat-attach-text', { detail: attachment }));
      if (sessionRuntime.layout?.isMobileLayout?.()) sessionRuntime.rightSidebar?.collapse();
    },
    resolveArtifact: (artifactId) => sessionRuntime.artifacts?.getArtifact(artifactId) || null,
  });

  onMount(() => {
    const statusEvents = createStatusEvents({
      onSnapshot: ({ ids, statuses }) => {
        runningSessionIds.clear();
        runningSessionProjects.clear();
        for (const id of ids) {
          runningSessionIds.add(id);
          const project = statuses?.[id]?.project;
          if (project) runningSessionProjects.set(id, project);
        }
      },
      onDelta: ({ id, running, project }) => {
        if (running) {
          runningSessionIds.add(id);
          if (project) runningSessionProjects.set(id, project);
        } else {
          runningSessionIds.delete(id);
          runningSessionProjects.delete(id);
        }
      },
    });
    statusEvents.connect();
    return () => statusEvents.cleanup();
  });

  onMount(() => {
    annotationScopes = [
      document.getElementById('messages'),
      document.getElementById('artifact-panel-host'),
    ].filter(Boolean);
    annotationComposer = document.getElementById('pi-chat-message');
    annotationCountEl = document.getElementById('annotation-tab-count');

    const onReload = () => sessionRuntime.annotations?.reapply();
    window.addEventListener('pi-session-reload', onReload);
    return () => window.removeEventListener('pi-session-reload', onReload);
  });

  // Restore the diff sheet from `?diff=open` on first load. Must seed
  // sessionModals.diff before the sync $effect runs, or that effect would see
  // open=false on first tick and strip the param before we read it. sessionId
  // is a $state prop in <SessionPage> set inside its own onMount, so we wait
  // for it (and only restore once).
  let diffRestored = false;
  $effect(() => {
    if (diffRestored || !sessionId) return;
    diffRestored = true;
    if (hasDiffUrlParam()) {
      sessionModals.diff.sessionId = sessionId;
      sessionModals.diff.open = true;
    }
  });

  // Mirror the modal's open state into the URL so a refresh restores the
  // sheet. Covers every close path (Escape, backdrop, mobile back-button,
  // Submit review), since they all flip sessionModals.diff.open.
  $effect(() => {
    if (!diffRestored) return;
    syncDiffUrlParam(sessionModals.diff.open);
  });
</script>

<SessionHeader {title} {cwd} {sessionId} {sessionUUID} />

<CommandMenu {sessionId} {runningSessionIds} />

<!-- Live reload (SSE) mounts before <ChatComposer> so its optimistic
     "message sent" listener is attached before the user can send. -->
<LiveReload {freshPrefetch} />

<div id="sidebar-overlay"></div>
<div id="app">
  <SessionTree {cwd} {sessionId} {runningSessionIds} {runningSessionProjects} {projectsRevision} />
  <div id="content-container" class="content-container">
    <main id="content">
      <div id="header-container"><SessionInfoHeader model={sessionModel} /></div>
      {#each pendingApprovals as approval (approval.id)}
        <ApprovalCard {approval} enabled={true} />
      {/each}
      <ResultCard {sessionId} />
      <LoadEarlier model={sessionModel} {sessionId} navigateTo={runtime.navigateTo} />
      <div id="messages">
        <SessionContent model={sessionModel} afterRender={contentRuntime.afterRender} live />
      </div>
    </main>
    <ChatComposer {sessionId} {chatAvailable} {chatDisabledReason} {cwd} {modelLabel} />
  </div>
  <RightSidebar {scratchpad} projectPath={cwd} {annotationConfig} />
  <ImageModal />
</div>

<ShortcutsModal bind:open={sessionModals.shortcuts} />
<ModelUsageModal bind:open={sessionModals.modelUsage} />
<ForkModal
  bind:open={sessionModals.fork.open}
  entries={sessionModals.fork.entries}
  onSelect={sessionModals.fork.onSelect}
/>
<CatGatekeeperSettings
  bind:open={sessionModals.catSettings.open}
  controller={sessionModals.catSettings.controller}
  onChange={sessionModals.catSettings.onChange}
/>
<LabelModal
  bind:open={sessionModals.label.open}
  entryId={sessionModals.label.entryId}
  currentLabel={sessionModals.label.currentLabel}
  onSave={sessionModals.label.onSave}
/>
<RenameModal
  bind:open={sessionModals.rename.open}
  currentName={sessionModals.rename.currentName}
  onSave={sessionModals.rename.onSave}
/>
<DiffModal bind:open={sessionModals.diff.open} sessionId={sessionModals.diff.sessionId} />

<NewSessionModal
  open={sessionModals.newSession}
  recent={newSessionRecent}
  workspaces={newSessionWorkspaces}
  bind:path={newSessionPath}
  creating={newSessionCreating}
  error={newSessionError}
  onClose={() => (sessionModals.newSession = false)}
  onCreate={createNewSession}
/>

<ProjectsModal
  open={sessionModals.projects}
  {projects}
  filterEnabled={projectsFilterEnabled}
  error={projectsError}
  busy={projectsBusy}
  onClose={() => (sessionModals.projects = false)}
  onToggleProject={(path, enabled) => updateProject(path, enabled ? 'enable' : 'disable')}
  onToggleAll={(enabled) => updateProject('', enabled ? 'enable-all' : 'disable-all')}
  onToggleFilter={(enabled) => updateProject('', enabled ? 'enable-filter' : 'disable-filter')}
  onRegister={(path) => updateProject(path, 'register')}
  onRemove={(path) => updateProject(path, 'remove')}
/>

<ShareDialog {sessionId} />
<CatGatekeeper />
<BtwPopup {cwd} parentId={sessionId} />
<svelte:element this={"script"} id="session-data" type="application/json" bind:this={dataEl}
></svelte:element>
