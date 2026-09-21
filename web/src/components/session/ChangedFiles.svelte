<script>
  // Per-file working-tree list behind the Result Card, with a working/staged/
  // unstaged diff-mode toggle. Fetches the changed-file list on mount and on
  // mode change (not the diff), then lazy-loads a single file's patch when
  // tapped — so a large repo never pulls the full diff up front.
  import { onMount } from 'svelte';
  import { getChangedFiles } from '../../session/result/result-api.js';
  import { t } from '../../shared/i18n.js';
  import FileDiffView from './FileDiffView.svelte';

  let { sessionId = '' } = $props();

  const MODES = ['working', 'staged', 'unstaged'];
  let mode = $state('working');
  let files = $state([]);
  let isRepo = $state(true);
  let loading = $state(true);
  let error = $state(false);
  let openPath = $state('');

  async function load() {
    loading = true;
    error = false;
    openPath = '';
    try {
      const res = await getChangedFiles(sessionId, { mode });
      isRepo = !!res.isRepo;
      files = Array.isArray(res.files) ? res.files : [];
    } catch {
      error = true;
    } finally {
      loading = false;
    }
  }

  onMount(load);

  function setMode(m) {
    if (m === mode) return;
    mode = m;
    load();
  }

  function toggle(path) {
    openPath = openPath === path ? '' : path;
  }

  function statusClass(f) {
    if (f.status === '??') return 'cf-status cf-status--new';
    if (f.status === 'D') return 'cf-status cf-status--del';
    if (f.status === 'A') return 'cf-status cf-status--new';
    return 'cf-status';
  }
</script>

<div class="changed-files" data-testid="changed-files">
  <div class="diffmode-toggle" role="group" aria-label={t('result.diff')} data-testid="diffmode-toggle">
    {#each MODES as m (m)}
      <button
        type="button"
        class="diffmode-btn"
        class:active={mode === m}
        data-mode={m}
        onclick={() => setMode(m)}>{t(`result.${m}`)}</button
      >
    {/each}
  </div>

  {#if loading}
    <div class="cf-status-line">{t('result.loadingFiles')}</div>
  {:else if error}
    <div class="cf-status-line cf-error">{t('result.filesError')}</div>
  {:else if !isRepo}
    <div class="cf-status-line">{t('result.notRepo')}</div>
  {:else if files.length === 0}
    <div class="cf-status-line">{t('result.noChanges')}</div>
  {:else}
    <ul class="cf-list">
      {#each files as f (f.path)}
        <li>
          <button
            type="button"
            class="cf-item"
            class:open={openPath === f.path}
            data-path={f.path}
            onclick={() => toggle(f.path)}
          >
            <span class={statusClass(f)}>{f.status}</span>
            <span class="cf-path">{f.path}</span>
            {#if f.added >= 0 || f.deleted >= 0}
              <span class="cf-counts">
                {#if f.added > 0}<span class="result-ins">+{f.added}</span>{/if}
                {#if f.deleted > 0}<span class="result-del">−{f.deleted}</span>{/if}
              </span>
            {/if}
          </button>
          {#if openPath === f.path}
            <FileDiffView {sessionId} path={f.path} {mode} />
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>
