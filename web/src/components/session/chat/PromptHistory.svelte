<script>
  // Prompt history popover: lists the session's past user prompts (newest
  // first) so one tap reloads a prompt into the composer for editing + resend.
  // Never auto-sends. The toggle sits inline in the composer toolbar; the panel
  // is a bottom-anchored popover so it opens upward over the message list.
  import { icon, Clock, X } from '../../../shared/icons.js';
  import { t } from '../../../shared/i18n.js';
  import { promptHistory } from './prompt-history.js';

  let { entries = [], textarea = null, onLoad = () => {} } = $props();

  let open = $state(false);
  const items = $derived(promptHistory(entries));

  function load(item) {
    if (!textarea) return;
    textarea.value = item.text;
    textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.focus();
    open = false;
    onLoad(item);
  }
</script>

<!-- eslint-disable svelte/no-at-html-tags -- trusted: Lucide icon SVG -->

<button
  type="button"
  class="prompt-history-toggle pi-chat-icon-button"
  title={t('composer.historyTitle')}
  aria-label={t('composer.historyTitle')}
  aria-expanded={open}
  onclick={() => (open = !open)}
  disabled={items.length === 0}
>
  {@html icon(Clock, { size: 15 })}
</button>

{#if open}
  <div class="prompt-history-panel" role="listbox" aria-label={t('composer.historyTitle')}>
    <div class="prompt-history-header">
      <span>{t('composer.historyTitle')}</span>
      <button
        type="button"
        class="prompt-history-close"
        aria-label={t('common.close')}
        onclick={() => (open = false)}>{@html icon(X, { size: 14 })}</button
      >
    </div>
    {#if items.length === 0}
      <div class="prompt-history-empty">{t('composer.historyEmpty')}</div>
    {:else}
      <div class="prompt-history-list">
        {#each items as item (item.id)}
          <button
            type="button"
            class="prompt-history-item"
            role="option"
            aria-selected="false"
            title={item.text}
            onclick={() => load(item)}
          >
            {item.preview}
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}
