<script>
  // PetWidget — fixed bottom-right companion overlay. Mounts on every SPA
  // route (index + session) so the pet is visible whether you're browsing the
  // list or inside a session. It is a pure overlay: it never touches layout,
  // the composer, or scroll state, and honors prefers-reduced-motion.
  //
  // Signals wired here:
  //   session page  — pi-chat-message-sent, pi-worker-done, chat-preview SSE
  //                   (via a per-session EventSource), approval store
  //   index/global  — status-delta/status-snapshot + attention on __all__
  //                   (only when the session route isn't driving the pet)
  import { onMount, tick } from 'svelte';
  import { createCodexSpriteRenderer } from '../../session/pet/codex-sprite-renderer.js';
  import { createCompanionRuntime } from '../../session/pet/companion-runtime.js';
  import {
    fetchPets,
    fetchPetManifest,
    fetchFioManifest,
    petPackageUrls,
  } from '../../session/pet/pet-api.js';
  import { createAppEvents } from '../../shared/app-events.js';
  import { createStatusEvents } from '../../shared/status-events.js';
  import {
    approvalsForSession,
    subscribeApprovals,
  } from '../../session/approval/approval-store.js';
  import { boolFor, valueFor } from '../../settings/settings-support.js';
  import { t } from '../../shared/i18n.js';

  let hostEl = $state(null);
  let widgetEl = $state(null);
  let visible = $state(false);
  let bubbleText = $state('');
  let petState = $state('idle');
  let hidden = $state(false);
  let flash = $state(false);
  let position = $state('bottom-right');
  let enabled = $state(false);
  // Drag offset (px) applied on top of the corner position. Persisted per
  // session in localStorage so the pet stays where the user put it.
  let dragX = $state(0);
  let dragY = $state(0);
  let dragging = $state(false);

  const BUBBLE_BY_STATE = {
    running: 'pet.bubbleRunning',
    waiting: 'pet.bubbleWaiting',
    review: 'pet.bubbleReview',
    failed: 'pet.bubbleFailed',
    completed: 'pet.bubbleCompleted',
  };

  onMount(() => {
    const win = window;
    const doc = document;
    const storage = win.localStorage;

    enabled = boolFor(null, 'pi-web:v1:pet:enabled', false, { storage });

    const sessionId = new URLSearchParams(win.location.search).get('id') || '';
    const onSessionPage = win.location.pathname === '/session' && sessionId;

    const scale = parseFloat(valueFor(null, 'pi-web:v1:pet:scale', '1', { storage })) || 1;
    const showBubble = boolFor(null, 'pi-web:v1:pet:bubble', true, { storage });
    const pos = valueFor(null, 'pi-web:v1:pet:position', 'bottom-right', { storage });
    position = pos === 'bottom-left' ? 'bottom-left' : 'bottom-right';

    const renderer = createCodexSpriteRenderer({
      documentImpl: doc,
      windowImpl: win,
      scale,
    });
    const runtime = createCompanionRuntime({ renderer, windowImpl: win });
    runtime.onState((next) => {
      petState = next;
      bubbleText = showBubble && BUBBLE_BY_STATE[next] ? t(BUBBLE_BY_STATE[next]) : '';
    });

    const media = win.matchMedia?.('(prefers-reduced-motion: reduce)');
    const applyMotion = () => runtime.setReducedMotion(!!media?.matches);
    applyMotion();
    media?.addEventListener?.('change', applyMotion);

    // Restore a previously dragged position.
    try {
      const saved = JSON.parse(storage?.getItem('pi-web:v1:pet:drag') || 'null');
      if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
        dragX = saved.x;
        dragY = saved.y;
      }
    } catch {}

    let disposed = false;
    const cleanups = [];
    const on = (host, type, handler, opts) => {
      host.addEventListener(type, handler, opts);
      cleanups.push(() => host.removeEventListener(type, handler, opts));
    };

    // The settings page writes through to localStorage before POSTing, so a
    // storage event lets us react to enable/selection changes on the same
    // page without a full reload.
    const onStorage = (e) => {
      if (e?.key === 'pi-web:v1:pet:enabled') {
        enabled = e.newValue === 'true';
        if (enabled) hidden = false;
      }
    };
    on(win, 'storage', onStorage);

    async function boot() {
      const wanted = valueFor(null, 'pi-web:v1:pet:id', '', { storage });
      const pets = await fetchPets({ fetchImpl: win.fetch.bind(win) });
      if (disposed || !pets.length) return;
      const chosen = pets.find((p) => p.id === wanted) || pets[0];
      try {
        const manifest = await fetchPetManifest(chosen.id, { fetchImpl: win.fetch.bind(win) });
        const fio = await fetchFioManifest(chosen.id, { fetchImpl: win.fetch.bind(win) });
        await renderer.load(petPackageUrls(chosen.id, manifest, fio));
      } catch {
        return; // broken package — stay hidden, never break the page
      }
      if (disposed) return;
      // Reveal the widget first so bind:this resolves, then attach the canvas.
      visible = true;
      await tick();
      if (disposed || !hostEl) return;
      renderer.attach(hostEl);
      runtime.start();
      // Seed the mapper with the current worker state so a page opened
      // mid-run doesn't sit idle until the first SSE delta.
      if (onSessionPage) {
        try {
          const r = await win.fetch(`/api/worker-status?id=${encodeURIComponent(sessionId)}`);
          const d = await r.json();
          if (d?.state) runtime.workerState(d.state);
        } catch {}
      }
    }
    if (enabled) void boot();

    if (onSessionPage) {
      // Session-scoped signals.
      on(win, 'pi-chat-message-sent', () => runtime.messageSent());
      on(win, 'pi-worker-done', () => runtime.workerState('idle'));
      const unsubApprovals = subscribeApprovals(() =>
        runtime.approvals(approvalsForSession(sessionId)),
      );
      cleanups.push(unsubApprovals);

      // Reuse the per-session SSE topic for chat-preview + approval events via
      // the shared multiplexer (does not open an extra connection).
      const previewEvents = createAppEvents({
        event: 'chat-preview',
        topic: sessionId,
        EventSourceImpl: win.EventSource,
        windowImpl: win,
        onEvent: (payload) => runtime.chatPreview(payload),
      });
      previewEvents.connect();
      cleanups.push(() => previewEvents.cleanup());
    }

    // Global signals (both routes): worker status + attention for this
    // session when on a session page, or "any session" when on the index.
    const statusEvents = createStatusEvents({
      EventSourceImpl: win.EventSource,
      windowImpl: win,
      onDelta: ({ id, running }) => {
        if (onSessionPage && id !== sessionId) return;
        runtime.workerState(running ? 'running' : 'idle');
      },
    });
    statusEvents.connect();
    cleanups.push(() => statusEvents.cleanup());

    const attentionEvents = createAppEvents({
      event: 'attention',
      EventSourceImpl: win.EventSource,
      windowImpl: win,
      onEvent: (row) => {
        if (!row || typeof row !== 'object') return;
        if (onSessionPage && row.sessionId && row.sessionId !== sessionId) return;
        runtime.attention({
          waiting: !!row.waiting,
          failed: !!row.failed,
          approval: !!row.approval,
        });
      },
    });
    attentionEvents.connect();
    cleanups.push(() => attentionEvents.cleanup());

    return () => {
      disposed = true;
      media?.removeEventListener?.('change', applyMotion);
      for (const fn of cleanups) fn();
      runtime.destroy();
    };
  });

  let tapTimer = null;
  let pressTimer = null;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let baseX = 0;
  let baseY = 0;

  function onTap() {
    if (moved) return; // a drag ending shouldn't also fire the tap reaction
    flash = true;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => (flash = false), 900);
  }

  function onPressStart(e) {
    moved = false;
    dragging = false;
    startX = e.clientX;
    startY = e.clientY;
    baseX = dragX;
    baseY = dragY;
    pressTimer = setTimeout(() => {
      if (!moved) hidden = true; // long-press (no move) hides
    }, 600);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function onPressMove(e) {
    if (pressTimer == null && !dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!dragging && Math.hypot(dx, dy) > 8) {
      dragging = true;
      moved = true;
      clearTimeout(pressTimer); // a drag cancels the long-press hide
    }
    if (dragging) {
      dragX = baseX + dx;
      dragY = baseY + dy;
    }
  }

  function onPressEnd() {
    clearTimeout(pressTimer);
    pressTimer = null;
    if (dragging) {
      try {
        localStorage.setItem('pi-web:v1:pet:drag', JSON.stringify({ x: dragX, y: dragY }));
      } catch {}
    }
    dragging = false;
    // `moved` stays true through the click event so onTap can ignore it.
    setTimeout(() => (moved = false), 0);
  }
</script>

{#if enabled && visible && !hidden}
  <div
    class="pet-widget pet-state-{petState} pet-pos-{position}"
    class:pet-dragging={dragging}
    role="img"
    aria-label={t('pet.ariaLabel')}
    data-pet-state={petState}
    style:transform={dragX || dragY ? `translate(${dragX}px, ${dragY}px)` : undefined}
    bind:this={widgetEl}
  >
    {#if bubbleText}
      <div class="pet-bubble" data-pet-bubble>{bubbleText}</div>
    {/if}
    <button
      type="button"
      class="pet-hit"
      class:pet-flash={flash}
      onclick={onTap}
      onpointerdown={onPressStart}
      onpointermove={onPressMove}
      onpointerup={onPressEnd}
      onpointercancel={onPressEnd}
      aria-label={t('pet.hide')}
    >
      <span class="pet-sprite" bind:this={hostEl}></span>
    </button>
  </div>
{/if}
