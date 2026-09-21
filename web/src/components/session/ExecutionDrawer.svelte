<script>
  // Execution summary drawer — a compact, ordered list of every command that
  // ran in the session. Each row expands to show exit code / duration / a
  // truncated output line / source / recovered-vs-final. The full log is never
  // loaded up front: only the structured CommandResult fields already computed
  // by command-result.js are rendered.
  import { t } from '../../shared/i18n.js';
  import { icon, Check, X, ChevronDown, ChevronRight, CircleAlert } from '../../shared/icons.js';

  let { results = [], recoveredIds = [] } = $props();
  const recovered = $derived(new Set(recoveredIds));

  let openId = $state('');

  function toggle(id) {
    openId = openId === id ? '' : id;
  }

  function fmtDuration(ms) {
    if (ms == null) return '';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  function statusOf(r) {
    if (r.cancelled) return 'cancelled';
    if (r.failed) return recovered.has(r.id) ? 'recovered' : 'failed';
    if (r.succeeded) return 'passed';
    return 'unknown';
  }
</script>

<!-- eslint-disable svelte/no-at-html-tags -- trusted: Lucide icon SVG -->

<div class="exec-drawer" data-testid="exec-drawer">
  {#if results.length === 0}
    <div class="cf-status-line">{t('result.noCommands')}</div>
  {:else}
    <ul class="exec-list">
      {#each results as r (r.id)}
        {@const st = statusOf(r)}
        <li>
          <button
            type="button"
            class="exec-item exec-item--{st}"
            data-exec-id={r.id}
            aria-expanded={openId === r.id}
            onclick={() => toggle(r.id)}
          >
            <span class="exec-icon">
              {#if st === 'passed'}{@html icon(Check, { size: 13 })}
              {:else if st === 'failed'}{@html icon(X, { size: 13 })}
              {:else if st === 'recovered'}{@html icon(CircleAlert, { size: 13 })}
              {:else if st === 'cancelled'}{@html icon(X, { size: 13 })}
              {:else}{@html icon(ChevronRight, { size: 13 })}{/if}
            </span>
            <span class="exec-cmd">{r.command}</span>
            <span class="exec-cat">{r.category}</span>
            {@html icon(openId === r.id ? ChevronDown : ChevronRight, { size: 13 })}
          </button>
          {#if openId === r.id}
            <div class="exec-detail">
              <div class="exec-detail-row"><span>{t('result.execStatus')}</span><b>{st}</b></div>
              {#if r.exitCode != null}
                <div class="exec-detail-row"><span>{t('result.execExit')}</span><b>{r.exitCode}</b></div>
              {/if}
              {#if r.durationMs != null}
                <div class="exec-detail-row"><span>{t('result.execDuration')}</span><b>{fmtDuration(r.durationMs)}</b></div>
              {/if}
              <div class="exec-detail-row"><span>{t('result.execSource')}</span><b>{r.source}</b></div>
              {#if r.outputSummary}
                <div class="exec-output">{r.outputSummary}</div>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>
