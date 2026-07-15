import { wrapLine } from '@shellicar/claude-core/reflow';
import { marked, type Token, type Tokens } from 'marked';
import type { CodeDecorator } from '../blockLayout.js';
import { HR_WIDTH } from '../dividerWidths.js';
import { ACCENT, BOLD, BOLD_END, BULLET, box, CODE_FG, DIM, FG, HEADING, ITALIC, ITALIC_END, link, R, STRIKE, STRIKE_END, SUB_BULLET } from './palette.js';

/**
 * Render an assistant `response` block as styled ANSI: parse with `marked`, walk
 * the token tree, and emit display lines. The fence is the boundary — prose
 * markdown is rendered (markers stripped, styled), while a fenced block is a
 * `code` token whose body is left literal and syntax-highlighted by `decorate`.
 *
 * A token walk (not `marked`'s string renderer) so output stays a line array the
 * wrapper can measure. `decorate` is the same count-preserving contract
 * blockContentLines uses — one line out per code line — so the rendered height is
 * predictable. Out-of-scope constructs (tables, task lists) fall through to raw
 * passthrough, untouched.
 */

/** Split a string on newlines and wrap each segment to the column width. */
function emitLines(text: string, cols: number): string[] {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    out.push(...wrapLine(line, cols));
  }
  return out;
}

/** Walk inline children (strong/em/del/codespan/link/image/text) to one styled string. */
function inline(tokens: Tokens.Generic[] | undefined): string {
  if (!tokens) {
    return '';
  }
  let out = '';
  for (const t of tokens) {
    switch (t.type) {
      case 'text':
        out += t.tokens ? inline(t.tokens) : (t as Tokens.Text).text;
        break;
      case 'escape':
        out += (t as Tokens.Escape).text;
        break;
      case 'strong':
        out += BOLD + inline(t.tokens) + BOLD_END;
        break;
      case 'em':
        out += ITALIC + inline(t.tokens) + ITALIC_END;
        break;
      case 'del':
        out += STRIKE + inline(t.tokens) + STRIKE_END;
        break;
      case 'codespan':
        out += CODE_FG + (t as Tokens.Codespan).text + FG;
        break;
      case 'br':
        out += '\n';
        break;
      case 'link': {
        const lt = t as Tokens.Link;
        out += link(lt.href, lt.text);
        break;
      }
      case 'image': {
        const im = t as Tokens.Image;
        out += link(im.href, im.text);
        break;
      }
      default:
        out += 'raw' in t ? (t.raw as string) : '';
        break;
    }
  }
  return out;
}

/** Separate a list item's own inline content from any lists nested under it. */
function listItemParts(item: Tokens.ListItem): { text: Tokens.Generic[]; nested: Tokens.List[] } {
  const text: Tokens.Generic[] = [];
  const nested: Tokens.List[] = [];
  for (const t of item.tokens) {
    if (t.type === 'list') {
      nested.push(t as Tokens.List);
    } else if ('tokens' in t && Array.isArray(t.tokens)) {
      text.push(...(t.tokens as Tokens.Generic[]));
    } else {
      text.push(t);
    }
  }
  return { text, nested };
}

/** Render a list: `•` at the top level, `◦` nested, ordered numbers kept literally. Two spaces of indent per level. */
function list(token: Tokens.List, cols: number, decorate: CodeDecorator, depth: number): string[] {
  const out: string[] = [];
  const pad = '  '.repeat(depth);
  let n = typeof token.start === 'number' ? token.start : 1;
  for (const item of token.items) {
    const marker = token.ordered ? `${n}. ` : depth === 0 ? ACCENT + BULLET + FG + ' ' : DIM + SUB_BULLET + R + ' ';
    const markerWidth = token.ordered ? `${n}. `.length : 2;
    const { text, nested } = listItemParts(item);
    // A hard break inside an item becomes a `\n` in inline(); split on it first so continuation
    // lines get the item's hanging indent rather than falling flush-left under the marker.
    const segments = inline(text).split('\n');
    for (let i = 0; i < segments.length; i++) {
      const prefix = i === 0 ? pad + marker : pad + ' '.repeat(markerWidth);
      out.push(...emitLines(prefix + segments[i], cols));
    }
    for (const sub of nested) {
      out.push(...list(sub, cols, decorate, depth + 1));
    }
    n++;
  }
  return out;
}

/** Render a blockquote: each produced line gets a dimmed `│` gutter and italic body. */
function quote(token: Tokens.Blockquote, cols: number, decorate: CodeDecorator): string[] {
  return blocks(token.tokens, cols, decorate).map((l) => `${DIM}\u2502${R} ${ITALIC}${l}${ITALIC_END}`);
}

/** Render block-level tokens to display lines (no outer indent; the caller adds it). */
function blocks(tokens: Token[], cols: number, decorate: CodeDecorator): string[] {
  const out: string[] = [];
  for (const t of tokens) {
    switch (t.type) {
      case 'heading': {
        const h = t as Tokens.Heading;
        const lvl = Math.min(h.depth, HEADING.length) - 1;
        out.push(...emitLines(BOLD + HEADING[lvl] + inline(h.tokens) + FG + BOLD_END, cols));
        break;
      }
      case 'paragraph':
        out.push(...emitLines(inline((t as Tokens.Paragraph).tokens), cols));
        break;
      case 'code': {
        const c = t as Tokens.Code;
        const lang = (c.lang ? c.lang.trim().split(/\s+/)[0] : '') || 'plaintext';
        out.push(...box(decorate(c.text, lang), lang, cols));
        break;
      }
      case 'list':
        out.push(...list(t as Tokens.List, cols, decorate, 0));
        break;
      case 'blockquote':
        out.push(...quote(t as Tokens.Blockquote, cols, decorate));
        break;
      case 'hr':
        out.push(DIM + '\u2500'.repeat(HR_WIDTH) + R);
        break;
      case 'space':
        out.push('');
        break;
      default:
        out.push(...emitLines((t.raw ?? '').replace(/\n+$/, ''), cols));
        break;
    }
  }
  return out;
}

/**
 * Lay a `response` block's markdown out into display rows, indented to match the
 * raw path. Mirrors blockContentLines' signature so the view and any measurement
 * share one walker, with `decorate` injected for code-body colour.
 */
export function markdownContentLines(content: string, cols: number, indent: string, decorate: CodeDecorator): string[] {
  const inner = Math.max(1, cols - indent.length);
  return blocks(marked.lexer(content), inner, decorate).map((l) => indent + l);
}
