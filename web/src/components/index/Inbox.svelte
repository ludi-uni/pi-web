<script>
  import { icon, Bell, CircleAlert, CircleHelp, Check, Clock } from '../../shared/icons.js';
  import { t } from '../../shared/i18n.js';
  import { handleNavClick } from '../../shared/navigation.js';
  import { prefetchSession } from '../../routes/session-prefetch.js';
  import { formatRelativeTime } from '../../index/sessions.js';

  let { groups = [], attentionCount = 0, runningStatuses = new Map(), now = Date.now() } = $props();

  const groupMeta = {
    waiting: { icon: CircleHelp, cls: 'inbox-group--waiting', label: 'inbox.waiting' },
    approval: { icon: Bell, cls: 'inbox-group--approval', label: 'inbox.approval' },
    failed: { icon: CircleAlert, cls: 'inbox-group--failed', label: 'inbox.failed' },
    unread: { icon: Check, cls: 'inbox-group--unread', label: 'inbox.completed' },
    running: { icon: Clock, cls: 'inbox-group--running', label: 'inbox.running' },
  };

  // Informational groups (completed-unread, running) start collapsed on
  // mobile so action-required items stay in the first viewport. Persisted per
  // group so a user who monitors running sessions keeps them expanded.
  const COLLAPSIBLE = new Set(['unread', 'running']);
  const COLLAPSED_KEY = 'pi-web:v1:inbox-collapsed';
  let collapsed = $state({});
  function readCollapsed() {
    try {
      return JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '{}') || {};
    } catch {
      return {};
    }
  }
  function isCollapsed(key) {
    // Default: collapsed on narrow screens, expanded on desktop.
    const stored = collapsed[key];
    if (stored !== undefined) return stored === 1;
    return COLLAPSIBLE.has(key) && mobile;
  }
  function toggleGroup(key) {
    collapsed = { ...collapsed, [key]: isCollapsed(key) ? 0 : 1 };
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsed));
    } catch {}
  }
  let mobile = $state(false);
  $effect(() => {
    collapsed = readCollapsed();
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(max-width: 900px)');
    const sync = () => (mobile = mql.matches);
    sync();
    mql.addEventListener('change', sync);
    return () => mql.removeEventListener('change', sync);
  });

  function subtitleFor(session, groupKey) {
    if (groupKey === 'running') {
      const status = runningStatuses.get(session.id);
      const model = status?.modelName || status?.model || '';
      return model ? `${t('inbox.runningFor')} · ${model}` : t('inbox.runningFor');
    }
    if (groupKey === 'failed') return t('inbox.failedHint');
    if (groupKey === 'waiting') return t('inbox.waitingHint');
    if (groupKey === 'approval') return t('inbox.approvalHint');
    return t('inbox.completedHint');
  }

  function timestampFor(session) {
    return session.lastActivity || '';
  }

  function open(session, event) {
    handleNavClick(event, `/session?id=${encodeURIComponent(session.id || '')}`);
  }
</script>

<!-- eslint-disable svelte/no-at-html-tags -- trusted: Lucide icon SVG -->

{#if groups.length > 0}
  <section class="inbox" data-testid="inbox" aria-label={t('inbox.title')}>
    <div class="inbox-header">
      <span class="inbox-title">
        <span class="inbox-title-icon" aria-hidden="true">{@html icon(Bell, { size: 14 })}</span>
        {t('inbox.needsAttention')}
      </span>
      <span class="inbox-count" data-inbox-count>{attentionCount}</span>
    </div>

    {#each groups as group (group.key)}
      {@const meta = groupMeta[group.key]}
      {@const collapsible = COLLAPSIBLE.has(group.key)}
      {@const isOpen = !isCollapsed(group.key)}
      <div class="inbox-group {meta.cls}" data-inbox-group={group.key}>
        {#if collapsible}
          <button
            type="button"
            class="inbox-group-label inbox-group-label--toggle"
            aria-expanded={isOpen}
            onclick={() => toggleGroup(group.key)}
          >
            <span class="inbox-group-icon" aria-hidden="true"
              >{@html icon(meta.icon, { size: 12 })}</span
            >
            {t(meta.label)}
            <span class="inbox-group-count">{group.sessions.length}</span>
            <span class="inbox-group-chev" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
          </button>
        {:else}
          <div class="inbox-group-label">
            <span class="inbox-group-icon" aria-hidden="true"
              >{@html icon(meta.icon, { size: 12 })}</span
            >
            {t(meta.label)}
            <span class="inbox-group-count">{group.sessions.length}</span>
          </div>
        {/if}
        <div class="inbox-items" hidden={collapsible && !isOpen}>
          {#each group.sessions as session (session.id)}
            <button
              type="button"
              class="inbox-item"
              data-session-id={session.id}
              onclick={(e) => open(session, e)}
              onpointerenter={() => session?.id && prefetchSession(session.id)}
              ontouchstart={() => session?.id && prefetchSession(session.id)}
            >
              <span class="inbox-item-main">
                <span class="inbox-item-title">{session.name || session.id}</span>
                <span class="inbox-item-sub">{subtitleFor(session, group.key)}</span>
              </span>
              <span class="inbox-item-side">
                {#if session.project}
                  <span class="inbox-item-project">{session.project}</span>
                {/if}
                <span class="inbox-item-time">{formatRelativeTime(timestampFor(session), now)}</span
                >
              </span>
            </button>
          {/each}
        </div>
      </div>
    {/each}
  </section>
{/if}
