// Convert the Markdown that LLMs produce into Telegram-safe HTML, and split long answers.

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

const TOKEN = '\u0000';

export function mdToTelegramHtml(md: string): string {
  const stash: string[] = [];
  const keep = (html: string): string => {
    stash.push(html);
    return `${TOKEN}${stash.length - 1}${TOKEN}`;
  };

  let s = md.replace(/\r\n?/g, '\n');

  // 1) fenced code blocks
  s = s.replace(/```([\w+#.-]*)[^\n]*\n([\s\S]*?)```/g, (_m, lang: string, code: string) => {
    const body = escapeHtml(code.replace(/\n$/, ''));
    return keep(lang ? `<pre><code class="language-${escapeAttr(lang)}">${body}</code></pre>` : `<pre>${body}</pre>`);
  });
  // unterminated fence (answer got cut): treat the rest as code
  s = s.replace(/```([\w+#.-]*)[^\n]*\n([\s\S]*)$/, (_m, lang: string, code: string) => {
    const body = escapeHtml(code.replace(/\n$/, ''));
    return keep(lang ? `<pre><code class="language-${escapeAttr(lang)}">${body}</code></pre>` : `<pre>${body}</pre>`);
  });

  // 2) inline code
  s = s.replace(/`([^`\n]+)`/g, (_m, code: string) => keep(`<code>${escapeHtml(code)}</code>`));

  // 3) escape everything else
  s = escapeHtml(s);

  // 4) block level
  s = s.replace(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm, '<b>$1</b>');
  s = s.replace(/^(\s*)[*+-]\s+/gm, '$1• ');
  s = s.replace(/^\s*([-*_]){3,}\s*$/gm, '──────────');
  // blockquote: consecutive "&gt; " lines
  s = s.replace(/(?:^&gt;\s?.*(?:\n|$))+/gm, (block) => {
    const inner = block
      .replace(/\n$/, '')
      .split('\n')
      .map((l) => l.replace(/^&gt;\s?/, ''))
      .join('\n');
    return `<blockquote>${inner}</blockquote>\n`;
  });

  // 5) inline styles
  s = s.replace(/\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*/g, '<b>$1</b>');
  s = s.replace(/__(?=\S)([^\n]+?)(?<=\S)__/g, '<b>$1</b>');
  s = s.replace(/~~(?=\S)([^\n]+?)(?<=\S)~~/g, '<s>$1</s>');
  s = s.replace(/(^|[^\w*])\*(?=[^\s*])([^*\n]+?)(?<=[^\s*])\*(?![\w*])/g, '$1<i>$2</i>');
  s = s.replace(/(^|[^\w])_(?=[^\s_])([^_\n]+?)(?<=[^\s_])_(?![\w])/g, '$1<i>$2</i>');

  // 6) links: [text](https://url)
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, text: string, url: string) => {
    return `<a href="${url.replace(/"/g, '&quot;')}">${text}</a>`;
  });

  // 7) restore stashed code
  s = s.replace(new RegExp(`${TOKEN}(\\d+)${TOKEN}`, 'g'), (_m, i: string) => stash[Number(i)] ?? '');
  return s.trim();
}

/** Split Markdown into chunks <= limit chars, never leaving a code fence open. */
export function splitMarkdown(md: string, limit = 3500): string[] {
  if (md.length <= limit) return [md];
  const lines = md.split('\n');
  const chunks: string[] = [];
  let cur: string[] = [];
  let curLen = 0;
  let fence: string | null = null; // language of the currently open fence, '' if none

  const flush = (): void => {
    if (cur.length === 0) return;
    let text = cur.join('\n');
    if (fence !== null) text += '\n```';
    chunks.push(text);
    cur = fence !== null ? ['```' + fence] : [];
    curLen = cur.length ? cur[0]!.length + 1 : 0;
  };

  for (const rawLine of lines) {
    // hard-split absurdly long single lines
    const pieces: string[] = [];
    let line = rawLine;
    while (line.length > limit) {
      pieces.push(line.slice(0, limit));
      line = line.slice(limit);
    }
    pieces.push(line);

    for (const piece of pieces) {
      if (curLen + piece.length + 1 > limit && cur.length > 0) flush();
      cur.push(piece);
      curLen += piece.length + 1;
      const m = /^```(\S*)/.exec(piece);
      if (m && pieces.length === 1) fence = fence === null ? (m[1] ?? '') : null;
    }
  }
  if (cur.length > 0 && cur.join('\n').trim().length > 0) chunks.push(cur.join('\n'));
  return chunks.filter((c) => c.trim().length > 0);
}

/** Markdown -> array of Telegram HTML messages (each <= 4096 chars). */
export function renderAnswer(md: string): { html: string; plain: string }[] {
  const text = md.trim() || '…';
  for (const limit of [3500, 2000, 1000]) {
    const parts = splitMarkdown(text, limit);
    const out = parts.map((p) => ({ html: mdToTelegramHtml(p), plain: p }));
    if (out.every((o) => o.html.length <= 4096)) return out;
  }
  // last resort: plain text pieces
  const out: { html: string; plain: string }[] = [];
  for (let i = 0; i < text.length; i += 3800) {
    const p = text.slice(i, i + 3800);
    out.push({ html: escapeHtml(p), plain: p });
  }
  return out;
}
