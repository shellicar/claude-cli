import { wrapLine } from '@shellicar/claude-core/reflow';
import { marked, type Token, type Tokens } from 'marked';
import type { CodeDecorator } from '../blockLayout.js';
import type { ClickRegion } from '../ClickRegion.js';
import { HR_WIDTH } from '../dividerWidths.js';
import { ACCENT, BOLD, BOLD_END, BULLET, box, CODE_FG, DIM, FG, HEADING, ITALIC, ITALIC_END, link, R, STRIKE, STRIKE_END, SUB_BULLET, table } from './palette.js';

/**
 * Render an assistant `response` block as styled ANSI: parse with `marked`, walk
 * the token tree, and emit display lines. The fence is the boundary — prose
 * markdown is rendered (markers stripped, styled), while a fenced block is a
 * `code` token whose body is left literal and syntax-highlighted by `decorate`.
 *
 * A token walk (not `marked`'s string renderer) so output stays a line array the
 * wrapper can measure. `decorate` is the same count-preserving contract
 * blockContentLines uses — one line out per code line — so the rendered height is
 * predictable. A construct the walk has no case for falls through to raw
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

/**
 * Lines, and the clickable spans within them, addressed relative to this array's own
 * first line. A caller splicing these into a larger array offsets the rows by where it
 * put them; one adding a prefix offsets the columns by the prefix's width.
 */
export type Laid = {
  lines: string[];
  regions: ClickRegion[];
};

const shift = (regions: readonly ClickRegion[], rows: number, columns: number): ClickRegion[] => regions.map((r) => ({ ...r, row: r.row + rows, startCol: r.startCol + columns, endCol: r.endCol + columns }));

/**
 * Hands out the identity of each code box in the order the walk draws them, which is the
 * same order the model recorded them in. Running out means the model holds no record for
 * this one, so it is drawn without an affordance rather than with a dead one.
 */
export type FenceIds = () => string | undefined;

/** A cursor over recorded fence ids, optionally resuming partway in when an earlier slice was drawn from cache. */
export function fenceCursor(ids: readonly string[], from = 0): FenceIds {
  let next = from;
  return () => ids[next++];
}

/** For the render paths that produce no clickable spans at all: scrollback, the history view. */
export const noFences: FenceIds = () => undefined;

/** Render a blockquote: each produced line gets a dimmed `│` gutter and italic body. */
function quote(token: Tokens.Blockquote, cols: number, decorate: CodeDecorator, fenceIds: FenceIds): Laid {
  const inner = blocks(token.tokens, cols, decorate, fenceIds);
  return { lines: inner.lines.map((l) => `${DIM}\u2502${R} ${ITALIC}${l}${ITALIC_END}`), regions: shift(inner.regions, 0, 2) };
}

/** Render block-level tokens to display lines (no outer indent; the caller adds it). */
function blocks(tokens: Token[], cols: number, decorate: CodeDecorator, fenceIds: FenceIds): Laid {
  const out: string[] = [];
  const regions: ClickRegion[] = [];
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
        // Drawn for every code box so the cursor stays in step with the walk, even where the
        // box turns out too narrow to carry the icon.
        const id = fenceIds();
        const drawn = box(decorate(c.text, lang), lang, cols, id !== undefined);
        if (id !== undefined && drawn.iconCol >= 0) {
          regions.push({ id, row: out.length, startCol: drawn.iconCol, endCol: drawn.iconCol, text: c.text });
        }
        out.push(...drawn.lines);
        break;
      }
      case 'list':
        out.push(...list(t as Tokens.List, cols, decorate, 0));
        break;
      case 'blockquote': {
        const quoted = quote(t as Tokens.Blockquote, cols, decorate, fenceIds);
        regions.push(...shift(quoted.regions, out.length, 0));
        out.push(...quoted.lines);
        break;
      }
      case 'table': {
        const tb = t as Tokens.Table;
        out.push(
          ...table(
            [tb.header, ...tb.rows].map((r) => r.map((cell) => inline(cell.tokens))),
            tb.align,
            cols,
          ),
        );
        break;
      }
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
  return { lines: out, regions };
}

/**
 * Lay a `response` block's markdown out into display rows, indented to match the
 * raw path. Mirrors blockContentLines' signature so the view and any measurement
 * share one walker, with `decorate` injected for code-body colour.
 */
export function markdownContent(content: string, cols: number, indent: string, decorate: CodeDecorator, fenceIds: FenceIds = noFences): Laid {
  const inner = Math.max(1, cols - indent.length);
  const laid = blocks(marked.lexer(content), inner, decorate, fenceIds);
  return { lines: laid.lines.map((l) => indent + l), regions: shift(laid.regions, 0, indent.length) };
}

/**
 * Lex `content` and split the resulting tokens at the last top-level `space` token (a blank line).
 * Everything up to and including that split is permanently sealed: marked's block tokenizer never
 * reaches back across an already-emitted `space` token to revise an earlier construct — a blank line
 * is what ends a paragraph/list/blockquote/etc. in the first place, so once one has been lexed, the
 * tokens before it cannot change no matter how much more text streams in afterward. Everything after
 * the split is the still-open tail: the block currently being written, which is unsafe to treat as
 * stable (inline emphasis in particular does not resolve monotonically — see markdownLayout.streaming-
 * corruption.spec.ts) and must be re-rendered in full every frame until its own closing blank line
 * arrives. A fence with no closing marker yet is naturally included in the tail: marked's fence rule
 * greedily consumes to end-of-input when unclosed, so it can never be followed by a `space` token
 * while still open.
 */
export function splitSealedTokens(content: string): { sealed: Token[]; tail: Token[] } {
  const tokens = marked.lexer(content);
  let lastSpace = -1;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i]?.type === 'space') {
      lastSpace = i;
    }
  }
  return { sealed: tokens.slice(0, lastSpace + 1), tail: tokens.slice(lastSpace + 1) };
}

/** Render an already-split token slice (see splitSealedTokens) to indented display lines. */
export function renderTokens(tokens: Token[], cols: number, indent: string, decorate: CodeDecorator, fenceIds: FenceIds = noFences): Laid {
  const inner = Math.max(1, cols - indent.length);
  const laid = blocks(tokens, inner, decorate, fenceIds);
  return { lines: laid.lines.map((l) => indent + l), regions: shift(laid.regions, 0, indent.length) };
}

/**
 * The code bodies a render draws a box for, in that order. Mirrors the walk in `blocks`: top
 * level and inside a blockquote, but not inside a list item, where a fence is flattened to
 * inline text and never boxed.
 */
function codeTexts(tokens: readonly Token[]): string[] {
  const out: string[] = [];
  for (const t of tokens) {
    if (t.type === 'code') {
      out.push((t as Tokens.Code).text);
    } else if (t.type === 'blockquote') {
      out.push(...codeTexts((t as Tokens.Blockquote).tokens));
    }
  }
  return out;
}

/** How many code boxes a token slice draws, so a cursor can resume past a slice rendered from cache. */
export function codeBoxCount(tokens: readonly Token[]): number {
  return codeTexts(tokens).length;
}

/**
 * Whether the last thing in the document is a code block. marked's fence rule consumes to
 * end of input when a fence never closes, so an unclosed one is always in this position and
 * nowhere else — which makes "not last" a proof that a fence closed.
 */
function endsInCode(tokens: readonly Token[]): boolean {
  const last = tokens[tokens.length - 1];
  if (!last) {
    return false;
  }
  if (last.type === 'code') {
    return true;
  }
  return last.type === 'blockquote' ? endsInCode((last as Tokens.Blockquote).tokens) : false;
}

/**
 * The code bodies in `content` that can no longer change, in the order a render draws them.
 *
 * `final` is a block that has sealed: nothing more is coming, so a fence left unclosed has
 * settled too. While a block is still being written the last code box is excluded when it is
 * also the document's last token, since that is the only place an open fence can be.
 */
export function settledCodeTexts(content: string, final: boolean): string[] {
  const tokens = marked.lexer(content);
  const texts = codeTexts(tokens);
  if (!final && endsInCode(tokens)) {
    texts.pop();
  }
  return texts;
}
