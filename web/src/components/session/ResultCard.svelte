<script>
  // Session Result Card — a compact summary of "what this session did" so the
  // user can judge the outcome on a phone without reading the whole transcript.
  // Data comes from structured signals only (git status API + session entries);
  // status is never inferred from assistant prose (see result-model.js).
  import { onMount } from 'svelte';
  import { getSessionModel } from '../../session/session-context.js';
  import { buildResult } from '../../session/result/result-model.js';
  import { getGitStatus, getGitHead } from '../../session/result/result-api.js';
  import { collectArtifacts } from '../../session/artifacts/artifact-registry.js';
  import { sessionRuntime } from '../../session/session-runtime.js';
  import { sessionModals } from '../../session/session-modals.svelte.js';
  import { t } from '../../shared/i18n.js';
  import {
    icon,
    FileDiff,
    FolderOpen,
    Copy,
    Check,
    CircleAlert,
    ListTree,
  } from '../../shared/icons.js';
  import { copyToClipboard } from '../../shared/clipboard.js';
  import { showToast } from '../../shared/toast.js';
  import ChangedFiles from './ChangedFiles.svelte';
  import ExecutionDrawer from './ExecutionDrawer.svelte';

  let { sessionId = '' } = $props();

  const model = getSessionModel();

  let git = $state(null);
  let head = $state(null);
  let loaded = $state(false);
  let failed = $state(false);
  let showFiles = $state(false);
  let showExec = $state(false);
  let copied = $state(false);

  const artifactCount = $derived(model ? collectArtifacts(model.entries).length : 0);
  const result = $derived(
    buildResult({ entries: model?.entries ?? [], git, head, artifactCount }),
  );
  // Ids of failures that recovered (any failed result that isn't the terminal
  // signal). Drives the "recovered" badge in the Execution drawer.
  const recoveredIds = $derived.by(() => {
    const rs = result.commandResults;
    if (rs.length === 0) return new Set();
    const lastFailedIdx = rs.map((r, i) => (r.failed ? i : -1)).filter((i) => i >= 0).pop();
    // Plain array is fine — ExecutionDrawer only calls .has() on it via a Set
    // wrapper built there; returning an Array keeps this a pure derivation.
    return rs.filter((r, i) => r.failed && i !== lastFailedIdx).map((r) => r.id);
  });

  async function refresh() {
    if (!sessionId) return;
    try {
      [git, head] = await Promise.all([
        getGitStatus(sessionId),
        getGitHead(sessionId).catch(() => null),
      ]);
      failed = false;
    } catch {
      git = null;
      failed = true;
    } finally {
      loaded = true;
    }
  }

  function viewChanges() {
    sessionModals.diff.sessionId = sessionId;
    sessionModals.diff.open = true;
  }

  function openArtifacts() {
    sessionRuntime.rightSidebar?.open();
    sessionRuntime.rightSidebar?.activateTab('artifacts');
  }

  async function copyReport() {
    const r = result;
    const lines = [
      `Session result: ${r.status}`,
      r.branch ? `Branch: ${r.branch}` : null,
      `Files changed: ${r.files}`,
      `Diff: +${r.insertions} / -${r.deletions}`,
      `Commands: ${r.commands.total} run, ${r.commands.failed} failed`,
      `Artifacts: ${r.artifactCount}`,
    ].filter(Boolean);
    if (await copyToClipboard(lines.join('\n'))) {
      copied = true;
      showToast(t('common.copied'), { id: 'result-copy', duration: 1200 });
      setTimeout(() => (copied = false), 1500);
    }
  }

  // Refetch whenever the session file reloads (fires on the running→idle
  // transition when the agent writes its final result) — no polling.
  onMount(() => {
    refresh();
    const onReload = () => refresh();
    window.addEventListener('pi-session-reload', onReload);
    return () => window.removeEventListener('pi-session-reload', onReload);
  });

  const statusLabel = $derived(
    {
      success: t('result.statusSuccess'),
      partial: t('result.statusPartial'),
      failed: t('result.statusFailed'),
      unknown: t('result.statusUnknown'),
    }[result.status] || result.status,
  );
</script>

<!-- eslint-disable svelte/no-at-html-tags -- trusted: Lucide icon SVG -->

{#if loaded && result.hasData}
  <section class="result-card" data-testid="result-card" data-status={result.status}>
    <header class="result-card-head">
      <span class="result-card-title">{t('result.title')}</span>
      <span class="result-status result-status--{result.status}">
        {#if result.status === 'failed' || result.status === 'partial'}
          {@html icon(CircleAlert, { size: 13 })}
        {:else}
          {@html icon(Check, { size: 13 })}
        {/if}
        {statusLabel}
      </span>
    </header>

    <dl class="result-grid">
      {#if result.isRepo}
        <div class="result-row">
          <dt>{t('result.branch')}</dt>
          <dd class="result-branch">
            {result.branch || '—'}{#if result.sha}<span class="result-sha">@{result.sha}</span>{/if}
          </dd>
        </div>
        {#if result.subject}
          <div class="result-row">
            <dt>HEAD</dt>
            <dd class="result-subject">{result.subject}</dd>
          </div>
        {/if}
        {#if result.hasUpstream}
          <div class="result-row">
            <dt>Upstream</dt>
            <dd>
              {#if result.ahead > 0}<span class="result-ins">↑{result.ahead} {t('result.ahead')}</span>{/if}
              {#if result.behind > 0}<span class="result-del">↓{result.behind} {t('result.behind')}</span>{/if}
              {#if result.ahead === 0 && result.behind === 0}✓{/if}
            </dd>
          </div>
        {/if}
        <div class="result-row">
          <dt>{t('result.files')}</dt>
          <dd>{result.files} {t('result.changed')}</dd>
        </div>
        <div class="result-row">
          <dt>{t('result.diff')}</dt>
          <dd>
            <span class="result-ins">+{result.insertions}</span>
            <span class="result-del">−{result.deletions}</span>
          </dd>
        </div>
      {/if}
      {#if result.commands.total > 0}
        <div class="result-row">
          <dt>{t('result.commands')}</dt>
          <dd>
            {result.commands.total}
            {#if result.commands.failed > 0}
              <span class="result-del">({result.commands.failed} {t('result.failedCount')})</span>
            {/if}
          </dd>
        </div>
      {/if}
      {#if result.artifactCount > 0}
        <div class="result-row">
          <dt>{t('result.artifacts')}</dt>
          <dd>{result.artifactCount}</dd>
        </div>
      {/if}
      {#if result.errors > 0}
        <div class="result-row">
          <dt>{t('result.errors')}</dt>
          <dd class="result-del">{result.errors}</dd>
        </div>
      {/if}
      {#if result.recoveredErrors > 0}
        <div class="result-row">
          <dt>{t('result.recoveredErrors')}</dt>
          <dd>{result.recoveredErrors}</dd>
        </div>
      {/if}
    </dl>

    {#if result.commandResults.length > 0}
      <div class="result-sections">
        {#each ['test', 'build', 'lint'] as cat (cat)}
          {@const items = result.byCategory[cat] || []}
          {#if items.length > 0}
            <div class="result-cat" data-cat={cat}>
              <div class="result-cat-title">{t(`result.cat.${cat}`)}</div>
              {#each items as r (r.id)}
                <div class="result-cat-row">
                  <span class="result-cat-cmd">{r.command}</span>
                  <span class="result-cat-status result-cat-status--{r.failed ? 'failed' : r.cancelled ? 'cancelled' : 'passed'}">
                    {r.failed ? t('result.failed') : r.cancelled ? t('result.cancelled') : t('result.passed')}
                  </span>
                </div>
              {/each}
            </div>
          {/if}
        {/each}
      </div>
    {/if}

    <div class="result-actions">
      {#if result.isRepo && result.files > 0}
        <button type="button" class="result-btn" data-testid="result-view-changes" onclick={viewChanges}>
          {@html icon(FileDiff, { size: 14 })} {t('result.viewChanges')}
        </button>
        <button
          type="button"
          class="result-btn"
          data-testid="result-toggle-files"
          aria-expanded={showFiles}
          onclick={() => (showFiles = !showFiles)}
        >
          {@html icon(FolderOpen, { size: 14 })} {t('result.changedFiles')}
        </button>
      {/if}
      {#if result.artifactCount > 0}
        <button type="button" class="result-btn" data-testid="result-open-artifacts" onclick={openArtifacts}>
          {t('result.artifacts')}
        </button>
      {/if}
      {#if result.commandResults.length > 0}
        <button
          type="button"
          class="result-btn"
          data-testid="result-toggle-exec"
          aria-expanded={showExec}
          onclick={() => (showExec = !showExec)}
        >
          {@html icon(ListTree, { size: 14 })} {t('result.execution')}
        </button>
      {/if}
      <button type="button" class="result-btn" data-testid="result-copy" onclick={copyReport}>
        {@html icon(Copy, { size: 14 })} {copied ? t('common.copied') : t('result.copyReport')}
      </button>
    </div>

    {#if showFiles}
      <ChangedFiles {sessionId} />
    {/if}
    {#if showExec}
      <ExecutionDrawer results={result.commandResults} recoveredIds={recoveredIds} />
    {/if}
  </section>
{:else if loaded && failed}
  <!-- Git fetch failed: render nothing rather than a misleading card. -->
{/if}
