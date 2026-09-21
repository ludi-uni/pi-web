// Paste handling for the composer. Image paste is already handled by
// attachment-manager.js (clipboard image/* → file attachment); this module only
// adds the "large text paste" affordance — a collapsible notice so a multi-KB
// log paste doesn't flood the textarea visually while keeping the full text.
//
import { t } from '../../../shared/i18n.js';

// The full pasted text still lands in the textarea (so Send works unchanged);
// we just collapse the textarea visually and show a dismissible banner.

export const LARGE_PASTE_BYTES = 10 * 1024; // 10KB

// isLargePaste reports whether a pasted plain-text payload should be treated
// as a "large paste" (collapsible notice rather than free expansion).
export function isLargePaste(text) {
  return typeof text === 'string' && text.length >= LARGE_PASTE_BYTES;
}

// setupLargePasteNotice listens for paste on the textarea and, when the pasted
// text is large, shows a collapsible banner above the composer. The textarea
// keeps the full text; the banner just collapses the field's visual height so
// the composer doesn't explode. Returns a dispose fn.
export function setupLargePasteNotice({ documentImpl = document, textarea, shell } = {}) {
  if (!textarea || !shell) return { dispose: () => {} };

  let banner = null;

  function removeBanner() {
    if (banner) {
      banner.remove();
      banner = null;
      shell.classList.remove('pi-chat-large-paste');
    }
  }

  function showBanner(sizeKb) {
    removeBanner();
    banner = documentImpl.createElement('div');
    banner.className = 'pi-chat-large-paste-banner';
    banner.setAttribute('role', 'status');

    const label = documentImpl.createElement('span');
    label.className = 'pi-chat-large-paste-label';
    label.textContent = t('composer.largePaste', { size: sizeKb });
    // t() is the shared i18n helper imported above.
    banner.appendChild(label);

    const dismiss = documentImpl.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'pi-chat-large-paste-dismiss';
    dismiss.setAttribute('aria-label', t('common.close'));
    dismiss.textContent = '×';
    dismiss.addEventListener('click', () => {
      removeBanner();
      textarea.classList.remove('pi-chat-textarea-collapsed');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    banner.appendChild(dismiss);

    shell.insertBefore(banner, shell.firstChild);
    // Collapse the textarea visually so the composer doesn't jump to max-height.
    textarea.classList.add('pi-chat-textarea-collapsed');
  }

  const onPaste = (event) => {
    const data = event.clipboardData;
    if (!data) return;
    const text = data.getData?.('text/plain') || '';
    if (!isLargePaste(text)) return;
    // Defer to after the paste lands so we measure the resulting value.
    setTimeout(() => showBanner(Math.round(text.length / 1024)), 0);
  };

  textarea.addEventListener('paste', onPaste);

  return {
    dispose: () => {
      textarea.removeEventListener('paste', onPaste);
      removeBanner();
    },
  };
}
