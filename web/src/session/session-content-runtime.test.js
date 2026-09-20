import { afterEach, describe, expect, it, vi } from 'vitest';
import { wireSessionContentRuntime } from './session-content-runtime.js';
import { resetSessionModals } from './session-modals.svelte.js';
import { resetSessionRuntime } from './session-runtime.js';

describe('wireSessionContentRuntime', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    resetSessionModals();
    resetSessionRuntime();
    vi.restoreAllMocks();
  });

  it('removes delegated listeners and restores downloadSessionJson on dispose', () => {
    document.body.innerHTML =
      '<div id="messages"><button class="label-btn" data-entry-id="e1"></button></div>';
    const previousDownload = vi.fn();
    const add = vi.spyOn(document.getElementById('messages'), 'addEventListener');
    const remove = vi.spyOn(document.getElementById('messages'), 'removeEventListener');
    window.downloadSessionJson = previousDownload;

    const { dispose } = wireSessionContentRuntime({
      windowImpl: window,
      documentImpl: document,
      model: {
        entries: [],
        header: {},
        toolCallMap: new Map(),
        labelMap: new Map(),
      },
      sessionId: 's.jsonl',
      contentRuntime: { afterRender: null },
      applyLazyHighlighting: vi.fn(),
    });

    expect(add).toHaveBeenCalledWith('click', expect.any(Function));
    expect(window.downloadSessionJson).not.toBe(previousDownload);

    dispose();

    expect(remove).toHaveBeenCalledWith('click', add.mock.calls[0][1]);
    expect(window.downloadSessionJson).toBe(previousDownload);
  });

  function setup({ html, entries = [] } = {}) {
    document.body.innerHTML = `<div id="messages">${html}</div>`;
    const writeText = vi.fn().mockResolvedValue(undefined);
    const windowImpl = {
      ...window,
      navigator: { clipboard: { writeText } },
      URL,
      Blob,
      confirm: vi.fn(() => true),
      fetch: vi.fn(),
    };
    wireSessionContentRuntime({
      windowImpl,
      documentImpl: document,
      model: {
        entries,
        header: {},
        toolCallMap: new Map(),
        labelMap: new Map(),
        currentLeafId: 'leaf',
      },
      sessionId: 's.jsonl',
      contentRuntime: { afterRender: null },
      applyLazyHighlighting: vi.fn(),
    });
    return { writeText };
  }

  it('copies a code block as plain text (no highlight markup)', async () => {
    const { writeText } = setup({
      html:
        '<div class="assistant-message"><div class="code-block">' +
        '<pre><code class="hljs"><span class="hljs-keyword">const</span> x = 1;</code></pre>' +
        '<button class="copy-block-btn"></button></div></div>',
    });
    document.querySelector('.copy-block-btn').click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('const x = 1;'));
  });

  it('copies the correct block when multiple code blocks exist', async () => {
    const { writeText } = setup({
      html:
        '<div class="code-block"><pre><code>first</code></pre>' +
        '<button class="copy-block-btn" id="b1"></button></div>' +
        '<div class="code-block"><pre><code>second</code></pre>' +
        '<button class="copy-block-btn" id="b2"></button></div>',
    });
    document.getElementById('b2').click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('second'));
    document.getElementById('b1').click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('first'));
  });

  it('does not break the message UI when the clipboard fails', async () => {
    document.body.innerHTML =
      '<div id="messages"><div class="code-block"><pre><code>x</code></pre>' +
      '<button class="copy-block-btn"></button></div></div>';
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    // No execCommand fallback in jsdom — clipboard.js returns false.
    const windowImpl = {
      ...window,
      navigator: { clipboard: { writeText } },
      URL,
      Blob,
      confirm: vi.fn(() => true),
      fetch: vi.fn(),
    };
    wireSessionContentRuntime({
      windowImpl,
      documentImpl: document,
      model: { entries: [], header: {}, toolCallMap: new Map(), labelMap: new Map() },
      sessionId: 's.jsonl',
      contentRuntime: { afterRender: null },
      applyLazyHighlighting: vi.fn(),
    });
    const btn = document.querySelector('.copy-block-btn');
    btn.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
    // Button stays in place and never flashes .copied on failure.
    expect(document.querySelector('.copy-block-btn')).toBe(btn);
    expect(btn.classList.contains('copied')).toBe(false);
  });

  it('copies the full output when a preview copy button sits in an expandable tool output', async () => {
    const { writeText } = setup({
      html:
        '<div class="tool-output expandable">' +
        '<div class="output-preview"><div class="code-block"><pre><code>line1</code></pre>' +
        '<button class="copy-block-btn"></button></div></div>' +
        '<div class="output-full"><div class="code-block"><pre><code>line1\nline2\nline3</code></pre>' +
        '<button class="copy-block-btn"></button></div></div>' +
        '</div>',
    });
    // Click the preview's copy button — it should copy the full text.
    document.querySelector('.output-preview .copy-block-btn').click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('line1\nline2\nline3'));
  });

  it('still copies assistant message text via .copy-text-btn (WIP regression)', async () => {
    const entries = [
      {
        id: 'e1',
        type: 'message',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'hello world' }],
        },
      },
    ];
    const { writeText } = setup({
      entries,
      html: '<button class="copy-text-btn" data-entry-id="e1"></button>',
    });
    document.querySelector('.copy-text-btn').click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('hello world'));
  });
});
