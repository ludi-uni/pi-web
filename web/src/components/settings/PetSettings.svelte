<script>
  // Pet settings — Codex-compatible companion overlay. Lists packages found in
  // ~/.pi/agent/pi-web/pets/ and ~/.codex/pets/ via /api/pets.
  import { onMount } from 'svelte';
  import { t } from '../../shared/i18n.js';
  import { boolFor, valueFor } from '../../settings/settings-support.js';
  import { fetchPets } from '../../session/pet/pet-api.js';

  let { settings = {}, onSave = () => {} } = $props();

  const enabledKey = 'pi-web:v1:pet:enabled';
  const idKey = 'pi-web:v1:pet:id';
  const scaleKey = 'pi-web:v1:pet:scale';
  const positionKey = 'pi-web:v1:pet:position';
  const bubbleKey = 'pi-web:v1:pet:bubble';

  let enabled = $derived(boolFor(settings, enabledKey, false));
  let petId = $derived(valueFor(settings, idKey, ''));
  let scale = $derived(valueFor(settings, scaleKey, '1'));
  let position = $derived(valueFor(settings, positionKey, 'bottom-right'));
  let bubble = $derived(boolFor(settings, bubbleKey, true));

  let pets = $state([]);
  onMount(async () => {
    pets = await fetchPets();
  });
</script>

<section class="settings-section">
  <div class="settings-section-title">{t('settings.pet')}</div>
  <div class="settings-row">
    <div class="settings-row-label">
      <span class="name">{t('settings.petEnable')}</span><span class="hint"
        >{t('settings.petEnableHint')}</span
      >
    </div>
    <div class="settings-control">
      <label class="settings-toggle"
        ><input
          type="checkbox"
          data-setting={enabledKey}
          checked={enabled}
          onchange={(e) => onSave(enabledKey, e.currentTarget.checked ? 'true' : 'false')}
        /><span class="slider"></span></label
      >
    </div>
  </div>
  <div class="settings-row">
    <div class="settings-row-label">
      <span class="name">{t('settings.petSelect')}</span><span class="hint"
        >{t('settings.petSelectHint')}</span
      >
    </div>
    <div class="settings-control">
      <select
        data-setting={idKey}
        value={petId}
        onchange={(e) => onSave(idKey, e.currentTarget.value)}
      >
        <option value="">{t('settings.petAuto')}</option>
        {#each pets as pet (pet.id)}
          <option value={pet.id}>{pet.displayName} ({pet.source})</option>
        {/each}
      </select>
    </div>
  </div>
  <div class="settings-row">
    <div class="settings-row-label">
      <span class="name">{t('settings.petScale')}</span><span class="hint"
        >{t('settings.petScaleHint')}</span
      >
    </div>
    <div class="settings-control">
      <select
        data-setting={scaleKey}
        value={scale}
        onchange={(e) => onSave(scaleKey, e.currentTarget.value)}
      >
        <option value="0.5">0.5×</option>
        <option value="0.75">0.75×</option>
        <option value="1">1×</option>
        <option value="1.5">1.5×</option>
        <option value="2">2×</option>
      </select>
    </div>
  </div>
  <div class="settings-row">
    <div class="settings-row-label">
      <span class="name">{t('settings.petPosition')}</span><span class="hint"
        >{t('settings.petPositionHint')}</span
      >
    </div>
    <div class="settings-control">
      <select
        data-setting={positionKey}
        value={position}
        onchange={(e) => onSave(positionKey, e.currentTarget.value)}
      >
        <option value="bottom-right">{t('settings.petPosBR')}</option>
        <option value="bottom-left">{t('settings.petPosBL')}</option>
      </select>
    </div>
  </div>
  <div class="settings-row">
    <div class="settings-row-label">
      <span class="name">{t('settings.petBubble')}</span><span class="hint"
        >{t('settings.petBubbleHint')}</span
      >
    </div>
    <div class="settings-control">
      <label class="settings-toggle"
        ><input
          type="checkbox"
          data-setting={bubbleKey}
          checked={bubble}
          onchange={(e) => onSave(bubbleKey, e.currentTarget.checked ? 'true' : 'false')}
        /><span class="slider"></span></label
      >
    </div>
  </div>
</section>
