// Markdown for email. Gmail and Outlook ignore style sheets and scripts, and the Apps Script
// back end has no DOM (so no DOMPurify). This turns the teacher's Markdown into inline-styled
// HTML by escaping everything first and only then adding our own tags, so no input can add
// markup of its own. It covers what feedback uses: paragraphs, bold, italics, lists, headings,
// quotes, code and http(s) links.
import { escapeHtml } from './escape';

export interface MarkdownStyle {
  /** Colour of a bold label that starts a paragraph ("**Điểm mạnh**: ..."). */
  accent: string;
}

const DEFAULT_STYLE: MarkdownStyle = { accent: '#111827' };

/** Bold, strikethrough and italics on escaped text. */
function emphasis(s: string): string {
  return s
    .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, '<strong>$2</strong>')
    .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, '<del>$1</del>')
    .replace(/(^|[^\w*])[*_](?=[^\s*_])([^*_\n]+?)[*_](?=[^\w*]|$)/g, '$1<em>$2</em>');
}

/** Inline Markdown on text that is already HTML-escaped. */
function inlineHtml(escaped: string): string {
  // Code spans and links are set aside first, so that a "_" or "*" inside a URL or code is
  // left alone.
  const kept: string[] = [];
  const keep = (html: string) => `\uE000${kept.push(html) - 1}\uE000`;
  const s = escaped
    .replace(/\uE000/g, '') // our placeholder character (private use) must not come from the input
    .replace(/`([^`]+)`/g, (_m, code: string) =>
      keep(
        `<code style="font-family:Consolas,Menlo,monospace;background:#f3f4f6;padding:0 3px">${code}</code>`,
      ),
    )
    .replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g, (_m, text: string, url: string) =>
      keep(`<a href="${url}" style="color:#c2410c">${emphasis(text)}</a>`),
    );
  let out = emphasis(s);
  // A link's text may hold a code span, so restore until nothing is left.
  while (out.includes('\uE000')) {
    out = out.replace(/\uE000(\d+)\uE000/g, (_m, i: string) => kept[Number(i)]);
  }
  return out;
}

const P_STYLE = 'margin:0 0 12px';
const LIST_STYLE = 'margin:0 0 12px;padding-left:22px';

/** A paragraph's lines, with a leading bold label set as a coloured heading line. */
function paragraphHtml(lines: string[], style: MarkdownStyle): string {
  const first = escapeHtml(lines[0]);
  const lead = /^\*\*([^*]+?)\*\*(:?)(.*)$/.exec(first);
  const rest = lines.slice(1).map(escapeHtml);
  if (!lead) return `<p style="${P_STYLE}">${[first, ...rest].map(inlineHtml).join('<br>')}</p>`;
  const [, label, colon, tail] = lead;
  const body = [tail.trim(), ...rest].filter(Boolean).map(inlineHtml).join('<br>');
  return (
    `<p style="${P_STYLE}"><strong style="display:block;margin-bottom:2px;font-size:16px;color:${style.accent}">${inlineHtml(label)}${colon}</strong>` +
    `${body}</p>`
  );
}

const BULLET = /^\s{0,3}[-*+]\s+(.*)$/;
const NUMBERED = /^\s{0,3}\d+[.)]\s+(.*)$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const FENCE = /^\s{0,3}```/;

/** Markdown to inline-styled, safe HTML blocks for an email. */
export function markdownToEmailHtml(text: string, style: MarkdownStyle = DEFAULT_STYLE): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
    } else if (FENCE.test(line)) {
      const code: string[] = [];
      for (i++; i < lines.length && !FENCE.test(lines[i]); i++) code.push(lines[i]);
      i++;
      out.push(
        `<pre style="margin:0 0 12px;padding:8px;background:#f3f4f6;white-space:pre-wrap;font-family:Consolas,Menlo,monospace;font-size:14px">${escapeHtml(code.join('\n'))}</pre>`,
      );
    } else if (RULE.test(line)) {
      out.push('<hr style="border:0;border-top:1px solid #e5e7eb;margin:12px 0">');
      i++;
    } else if (HEADING.test(line)) {
      const heading = HEADING.exec(line)![1];
      out.push(
        `<p style="margin:0 0 6px;font-size:16px;font-weight:bold;color:${style.accent}">${inlineHtml(escapeHtml(heading))}</p>`,
      );
      i++;
    } else if (BULLET.test(line) || NUMBERED.test(line)) {
      const ordered = NUMBERED.test(line) && !BULLET.test(line);
      const marker = ordered ? NUMBERED : BULLET;
      const items: string[] = [];
      for (; i < lines.length && marker.test(lines[i]); i++) {
        items.push(marker.exec(lines[i])![1]);
        // A line that continues the item (indented, not a new marker).
        while (
          i + 1 < lines.length &&
          /^\s{2,}\S/.test(lines[i + 1]) &&
          !BULLET.test(lines[i + 1]) &&
          !NUMBERED.test(lines[i + 1])
        ) {
          items[items.length - 1] += `\n${lines[++i].trim()}`;
        }
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(
        `<${tag} style="${LIST_STYLE}">${items
          .map(
            (item) =>
              `<li style="margin-bottom:4px">${item
                .split('\n')
                .map((l) => inlineHtml(escapeHtml(l)))
                .join('<br>')}</li>`,
          )
          .join('')}</${tag}>`,
      );
    } else if (QUOTE.test(line)) {
      const quoted: string[] = [];
      for (; i < lines.length && QUOTE.test(lines[i]); i++) quoted.push(QUOTE.exec(lines[i])![1]);
      out.push(
        `<blockquote style="margin:0 0 12px;padding:0 0 0 12px;border-left:3px solid #d1d5db;color:#4b5563">${quoted
          .map((l) => inlineHtml(escapeHtml(l)))
          .join('<br>')}</blockquote>`,
      );
    } else {
      const para: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !FENCE.test(lines[i]) &&
        !HEADING.test(lines[i]) &&
        !BULLET.test(lines[i]) &&
        !NUMBERED.test(lines[i]) &&
        !QUOTE.test(lines[i]) &&
        !RULE.test(lines[i])
      ) {
        para.push(lines[i].trim());
        i++;
      }
      out.push(paragraphHtml(para, style));
    }
  }
  return out.join('\n');
}

/** Markdown to plain text for the text part of the email: syntax removed, line breaks kept. */
export function markdownToPlainText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/```[^\n]*\n?([\s\S]*?)```/g, '$1')
    .replace(/!?\[([^\]]*)\]\(([^)\s]*)\)/g, (_m, t: string, url: string) =>
      t === url ? t : `${t} (${url})`,
    )
    .replace(/^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/gm, '$1')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}[-*+]\s+/gm, '- ')
    .replace(/(\*\*|__|~~)(?=\S)(.+?)(?<=\S)\1/g, '$2')
    .replace(/(^|[^\w*])[*_](?=[^\s*_])([^*_\n]+?)[*_](?=[^\w*]|$)/g, '$1$2')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
