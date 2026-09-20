export const strictStrikethroughRegex =
  /^(~~)(?=[^\s~])((?:\\.|[^\\])*?(?:\\.|[^\s~\\]))\1(?=[^~]|$)/;

// Wrap a rendered code <pre> in .code-block with a copy button. The button is
// a native <button> (keyboard + screen-reader accessible); the icon is a
// Lucide "copy" outline. CSS keeps it hidden on desktop (hover/focus reveal)
// and always-visible-but-muted on mobile. The label is English here — the
// marked renderer has no access to t(); the delegated handler in
// session-content-runtime owns the click.
function codeBlock(preHtml) {
  return (
    `<div class="code-block">${preHtml}` +
    `<button type="button" class="copy-block-btn" aria-label="Copy code" title="Copy code">` +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>` +
    `</button></div>`
  );
}

export function configureSessionMarkdown({ marked, hljs, escapeHtml }) {
  marked.use({
    breaks: true,
    gfm: true,
    tokenizer: {
      html() {
        return undefined;
      },
      tag() {
        return undefined;
      },
      del(src) {
        const match = strictStrikethroughRegex.exec(src);
        if (!match) return undefined;
        return {
          type: 'del',
          raw: match[0],
          text: match[2],
          tokens: this.lexer.inlineTokens(match[2]),
        };
      },
    },
    renderer: {
      link(token) {
        const href = (token.href || '').trim();
        if (/^\s*(javascript|vbscript|data):/i.test(href)) {
          return this.parser.parseInline(token.tokens);
        }
        let out = '<a href="' + escapeHtml(href) + '"';
        if (token.title) {
          out += ' title="' + escapeHtml(token.title) + '"';
        }
        out += '>' + this.parser.parseInline(token.tokens) + '</a>';
        return out;
      },
      image(token) {
        const href = (token.href || '').trim();
        if (/^\s*(javascript|vbscript|data):/i.test(href)) {
          return escapeHtml(token.text || '');
        }
        let out = '<img src="' + escapeHtml(href) + '" alt="' + escapeHtml(token.text || '') + '"';
        if (token.title) {
          out += ' title="' + escapeHtml(token.title) + '"';
        }
        out += '>';
        return out;
      },
      code(token) {
        const code = token.text;
        const lang = token.lang;
        if (hljs) {
          let highlighted;
          if (lang && hljs.getLanguage(lang)) {
            try {
              highlighted = hljs.highlight(code, { language: lang }).value;
            } catch {
              highlighted = escapeHtml(code);
            }
          } else {
            try {
              highlighted = hljs.highlightAuto(code).value;
            } catch {
              highlighted = escapeHtml(code);
            }
          }
          return codeBlock(`<pre><code class="hljs">${highlighted}</code></pre>`);
        }
        // hljs not yet loaded: plain text, marked for lazy highlighting
        const dataLang = lang ? ` data-lang="${escapeHtml(lang)}"` : '';
        return codeBlock(
          `<pre><code class="hljs" data-highlight-pending${dataLang}>${escapeHtml(code)}</code></pre>`,
        );
      },
      codespan(token) {
        return `<code>${escapeHtml(token.text)}</code>`;
      },
    },
  });
}

export function safeMarkedParse(text, { marked }) {
  return marked.parse(text);
}
