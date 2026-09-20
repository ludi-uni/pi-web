<script module>
  // Click-to-expand tool output. Mirrors the former formatExpandableOutput():
  // a preview of the first `maxLines`, click to reveal the full text. Code output
  // (with a `lang`) renders <code class="hljs" data-highlight-pending> so the
  // post-render highlight pass (live: applyLazyHighlighting; export: afterRender)
  // colours it. Plain output renders one <div> per line.
  export function toggleExpanded(e) {
    if (window.getSelection && window.getSelection().toString()) return;
    // Copy button inside the output: let the click bubble to the delegated
    // #messages handler without toggling expand.
    if (e.target.closest?.('.copy-block-btn')) return;
    e.currentTarget.classList.toggle('expanded');
  }
</script>

<script>
  import { splitOutputLines } from '../../session/render/entry-format.js';
  import { icon, Copy } from '../../shared/icons.js';
  import { t } from '../../shared/i18n.js';

  let { text = '', maxLines = 10, lang = null } = $props();

  const split = $derived(splitOutputLines(text, maxLines));
  const expandable = $derived(split.remaining > 0);
</script>

<!-- eslint-disable svelte/no-at-html-tags -- trusted: Lucide icon SVG -->
{#snippet copyBtn()}
  <button
    type="button"
    class="copy-block-btn"
    aria-label={t('session.copyCode')}
    title={t('session.copyCode')}>{@html icon(Copy, { size: 14 })}</button
  >
{/snippet}

{#if lang}
  {#if expandable}
    <div class="tool-output expandable" onclick={toggleExpanded} role="presentation">
      <div class="output-preview">
        <div class="code-block">
          <pre><code class="hljs" data-highlight-pending data-lang={lang}
              >{split.preview.join('\n')}</code
            ></pre>
          {@render copyBtn()}
        </div>
        <div class="expand-hint">... ({split.remaining} more lines)</div>
      </div>
      <div class="output-full">
        <div class="code-block">
          <pre><code class="hljs" data-highlight-pending data-lang={lang}
              >{split.lines.join('\n')}</code
            ></pre>
          {@render copyBtn()}
        </div>
      </div>
    </div>
  {:else}
    <div class="tool-output">
      <div class="code-block">
        <pre><code class="hljs" data-highlight-pending data-lang={lang}
            >{split.lines.join('\n')}</code
          ></pre>
        {@render copyBtn()}
      </div>
    </div>
  {/if}
{:else if expandable}
  <div class="tool-output expandable" onclick={toggleExpanded} role="presentation">
    <div class="output-preview">
      {#each split.preview as line, lineIndex (lineIndex)}<div>{line}</div>{/each}
      <div class="expand-hint">... ({split.remaining} more lines)</div>
    </div>
    <div class="output-full">
      {#each split.lines as line, lineIndex (lineIndex)}<div>{line}</div>{/each}
    </div>
  </div>
{:else}
  <div class="tool-output code-block">
    {#each split.preview as line, lineIndex (lineIndex)}<div>{line}</div>{/each}
    {@render copyBtn()}
  </div>
{/if}
