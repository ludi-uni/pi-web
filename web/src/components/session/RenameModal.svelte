<script>
  // Session rename modal — replaces the former window.prompt() flow so the
  // rename affordance matches the app's sheet/modal styling (and works on
  // mobile). Opened via the bindable `open` prop; `onSave({ name })` persists
  // (the caller handles the API + title update). Mirrors LabelModal.
  import { tick } from 'svelte';
  import { t } from '../../shared/i18n.js';

  let { open = $bindable(false), currentName = '', onSave = null } = $props();

  let value = $state('');
  let inputEl = $state(null);
  let backdropEl = $state(null);

  function close() {
    open = false;
  }
  function submit() {
    const name = value.trim();
    if (!name || name === currentName) {
      close();
      return;
    }
    onSave?.({ name });
    close();
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  }

  // Initialize the field + focus each time it opens; close on backdrop click
  // (attached imperatively to match the codebase convention + avoid a11y lint).
  $effect(() => {
    if (!open) return;
    value = currentName || '';
    tick().then(() => {
      inputEl?.focus();
      inputEl?.select();
    });
    const onBackdropClick = (e) => {
      if (e.target === backdropEl) close();
    };
    backdropEl?.addEventListener('click', onBackdropClick);
    return () => backdropEl?.removeEventListener('click', onBackdropClick);
  });
</script>

{#if open}
  <div id="rename-modal-backdrop" class="label-modal-backdrop" bind:this={backdropEl}>
    <div class="label-modal" role="dialog" aria-modal="true" aria-labelledby="rename-modal-title">
      <h3 id="rename-modal-title">{t('menu.renamePrompt')}</h3>
      <label class="label-modal-field">
        <span>{t('session.sessionName')}</span>
        <input
          id="rename-modal-input"
          type="text"
          autocomplete="off"
          spellcheck="false"
          bind:value
          bind:this={inputEl}
          onkeydown={onKey}
        />
      </label>
      <div class="label-modal-actions">
        <span class="label-modal-spacer"></span>
        <button type="button" class="label-modal-cancel" onclick={close}
          >{t('common.cancel')}</button
        >
        <button
          type="button"
          class="label-modal-save"
          data-testid="rename-save"
          disabled={!value.trim() || value.trim() === currentName}
          onclick={submit}>{t('common.save')}</button
        >
      </div>
    </div>
  </div>
{/if}
