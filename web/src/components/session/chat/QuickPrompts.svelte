<script>
  // Horizontally scrollable chip row of one-tap prompt snippets for the mobile
  // composer. Tapping a chip appends its prompt text to the textarea (never
  // sends directly). The list is frontend-only data loaded from localStorage;
  // malformed entries fall back to the built-in defaults.
  //
  // Desktop keeps this hidden via CSS — the row is a small-screen affordance.
  // The component itself is live-only (mounted inside ChatComposer, which is
  // not part of the static export).
  import { loadQuickPrompts } from './quick-prompts.js';

  let { textarea = null, onInsert = () => {} } = $props();

  const prompts = loadQuickPrompts();

  function insertPrompt(prompt) {
    if (!textarea || !prompt?.prompt) return;
    const current = textarea.value || '';
    const separator = current && !current.endsWith('\n') ? '\n' : '';
    textarea.value = current + separator + prompt.prompt;
    // Move cursor to the end so the user can continue typing immediately.
    textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
    // Let the existing input handler run autoResize + updateSendEnabled.
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    onInsert(prompt);
  }
</script>

<div class="quick-prompts" role="toolbar" aria-label="Quick prompts">
  {#each prompts as item (item.id)}
    <button
      type="button"
      class="quick-prompt-chip"
      onclick={() => insertPrompt(item)}
      aria-label={item.label}
      disabled={!textarea}
    >
      {item.label}
    </button>
  {/each}
</div>
