import { describe, expect, it } from 'vitest';
import { Marked } from 'marked';
import hljs from 'highlight.js';
import { configureSessionMarkdown, safeMarkedParse, strictStrikethroughRegex } from './markdown.js';

describe('session markdown', () => {
  it('matches only strict strikethrough markers', () => {
    expect(strictStrikethroughRegex.test('~~gone~~')).toBe(true);
    expect(strictStrikethroughRegex.test('~~ spaced ~~')).toBe(false);
  });

  it('sanitizes unsafe links and treats html as text', () => {
    const instance = new Marked();
    configureSessionMarkdown({
      marked: instance,
      hljs,
      escapeHtml: (text) =>
        String(text).replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
    });

    expect(safeMarkedParse('[x](javascript:alert(1))', { marked: instance })).not.toContain(
      'href=',
    );
    expect(safeMarkedParse('<script>alert(1)</script>', { marked: instance })).toContain(
      '&lt;script&gt;',
    );
  });

  it('renders code blocks through highlight.js wrapper', () => {
    const instance = new Marked();
    configureSessionMarkdown({ marked: instance, hljs, escapeHtml: (text) => String(text) });
    expect(safeMarkedParse('```js\nconst x = 1;\n```', { marked: instance })).toContain(
      'class="hljs"',
    );
  });

  it('wraps code blocks in .code-block with a copy button', () => {
    const instance = new Marked();
    configureSessionMarkdown({ marked: instance, hljs, escapeHtml: (text) => String(text) });
    const html = safeMarkedParse('```js\nconst x = 1;\n```', { marked: instance });
    expect(html).toContain('class="code-block"');
    expect(html).toContain('class="copy-block-btn"');
    expect(html).toContain('aria-label="Copy code"');
    // The <pre> stays inside the wrapper so lazy highlighting still finds it.
    expect(html).toMatch(/<div class="code-block"><pre><code class="hljs"/);
  });

  it('wraps code blocks without hljs too (lazy-highlight path)', () => {
    const instance = new Marked();
    configureSessionMarkdown({ marked: instance, hljs: null, escapeHtml: (text) => String(text) });
    const html = safeMarkedParse('```\nplain\n```', { marked: instance });
    expect(html).toContain('class="code-block"');
    expect(html).toContain('data-highlight-pending');
  });
});
