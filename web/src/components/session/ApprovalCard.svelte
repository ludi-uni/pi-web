<script>
  // Approval card — renders a pending approval and lets the operator Approve or
  // Reject. The decision goes to POST /api/approval/decide with only the
  // approval id + decision (the action payload stays server-side). The card is
  // removed by the canonical approval_resolved/rejected SSE event via the
  // approval store — NOT optimistically — so the UI always reflects pi's state.
  import { t } from '../../shared/i18n.js';
  import { icon, CircleAlert } from '../../shared/icons.js';
  import { postJSON } from '../../shared/api.js';
  import { showToast } from '../../shared/toast.js';

  let { approval = null, enabled = true } = $props();

  let submitting = $state(false);
  let decided = $state('');

  const canAct = $derived(enabled && !submitting && !decided && approval?.status === 'pending');

  async function decide(decision) {
    if (!canAct || !approval?.id) return;
    submitting = true;
    try {
      const res = await postJSON('/api/approval/decide', {
        approvalId: approval.id,
        decision,
        sessionId: approval.sessionId,
      });
      if (res?.ok) {
        decided = decision;
        // The card is removed when the approval_resolved/rejected SSE event
        // arrives and the store drops it from pending — we don't remove it here.
      } else {
        showToast(res?.reason || t('approval.decideFailed'), { id: 'approval-err' });
      }
    } catch (e) {
      showToast(e?.message || t('approval.decideFailed'), { id: 'approval-err' });
    } finally {
      submitting = false;
    }
  }
</script>

<!-- eslint-disable svelte/no-at-html-tags -- trusted: Lucide icon SVG -->

{#if approval}
  <section class="approval-card" data-testid="approval-card" data-risk={approval.risk ?? ''}>
    <header class="approval-card-head">
      {@html icon(CircleAlert, { size: 15 })}
      <span class="approval-card-title">{t('approval.title')}</span>
      {#if approval.risk}
        <span class="approval-risk approval-risk--{approval.risk}">{approval.risk}</span>
      {/if}
    </header>
    {#if approval.title}<div class="approval-name">{approval.title}</div>{/if}
    {#if approval.description}<p class="approval-desc">{approval.description}</p>{/if}
    {#if approval.requestedAction}
      <div class="approval-action">
        <span class="approval-action-label">{t('approval.runCommand')}:</span>
        <code class="approval-action-cmd">{approval.requestedAction}</code>
      </div>
    {/if}
    <div class="approval-actions">
      <button
        type="button"
        class="approval-btn approval-btn--approve"
        disabled={!canAct}
        data-testid="approval-approve"
        onclick={() => decide('approve')}
        >{submitting ? '…' : t('approval.approve')}</button
      >
      <button
        type="button"
        class="approval-btn approval-btn--reject"
        disabled={!canAct}
        data-testid="approval-reject"
        onclick={() => decide('reject')}>{t('approval.reject')}</button
      >
    </div>
  </section>
{/if}
