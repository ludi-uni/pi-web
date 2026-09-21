<script>
  // Lazy single-file unified-diff renderer. Fetches /api/git/file-diff only when
  // mounted (i.e. when the file row is expanded), renders a lightweight
  // mobile-friendly patch — no heavy shadow-DOM renderer. Caps the rendered
  // lines so a giant file can't freeze the UI; the rest is truncated with a
  // note. Binary files show a placeholder.
  import { onMount } from 'svelte';
  import { getFileDiff } from '../../session/result/result-api.js';
  import { t } from '../../shared/i18n.js';

  let { sessionId = '', path = '', mode = 'working' } = $props();

  // Hard cap on rendered diff lines per file (mobile perf guard).
  const MAX_LINES = 400;

  let loading = $state(true);
  let error = $state(false);
  let lines = $state([]);
  let truncated = $state(false);
  let binary = $state(false);

  function classify(line) {
    if (line.startsWith('+++') || line.startsWith('---')) return 'diff-line diff-meta';
    if (line.startsWith('@@')) return 'diff-line diff-hunk';
    if (line.startsWith('+')) return 'diff-line diff-add';
    if (line.startsWith('-')) return 'diff-line diff-del';
    if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('Binary'))
      return 'diff-line diff-meta';
    return 'diff-line diff-ctx';
  }

  onMount(async () => {
    try {
      const res = await getFileDiff(sessionId, path, { mode });
      const text = res.diff || '';
      if (/^Binary files/m.test(text) || text.includes('\u0000')) {
        binary = true;
        lines = [];
      } else {
        const all = text.split('\n');
        truncated = all.length > MAX_LINES;
        lines = (truncated ? all.slice(0, MAX_LINES) : all).map((raw) => ({
          raw,
          cls: classify(raw),
        }));
      }
    } catch {
      error = true;
    } finally {
      loading = false;
    }
  });
</script>

<div class="file-diff" data-testid="file-diff">
  {#if loading}
    <div class="cf-status-line">{t('result.loadingDiff')}</div>
  {:else if error}
    <div class="cf-status-line cf-error">{t('result.diffError')}</div>
  {:else if binary}
    <div class="cf-status-line">{t('result.binaryFile')}</div>
  {:else if lines.length === 0}
    <div class="cf-status-line">{t('result.noDiff')}</div>
  {:else}
    <pre class="file-diff-pre" data-path={path}
      >{#each lines as l, i (i)}<span class={l.cls}>{l.raw}
</span>{/each}{#if truncated}<span class="diff-line diff-meta"
          >{t('result.diffTruncated', { count: MAX_LINES })}</span
        >{/if}</pre>
  {/if}
</div>
