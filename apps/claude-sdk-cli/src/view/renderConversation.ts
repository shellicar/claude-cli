import { DateTimeFormatter, Duration, type Instant, ZoneId } from '@js-joda/core';
import { DIM, RESET } from '@shellicar/claude-core/ansi';
import { wrapLine } from '@shellicar/claude-core/reflow';
import { highlight, supportsLanguage } from 'cli-highlight';
import stringWidth from 'string-width';
import type { MarkdownConfig } from '../cli-config/types.js';
import { blockContentLines, CONTENT_INDENT } from '../model/blockLayout.js';
import type { Block, ConversationState } from '../model/ConversationState.js';
import { MIN_DIVIDER_WIDTH } from '../model/dividerWidths.js';
import { markdownContentLines, renderTokenLines, splitSealedTokens } from '../model/markdown/markdownLayout.js';
import { formatDuration } from './formatDuration.js';

const FILL = '\u2500';

const BLOCK_PLAIN: Record<string, string> = {
  prompt: 'prompt',
  thinking: 'thinking',
  response: 'response',
  tools: 'tool use',
  execution: 'execution',
  compaction: 'compaction',
  meta: 'query',
};

const BLOCK_EMOJI: Record<string, string> = {
  prompt: '💬 ',
  thinking: '💭 ',
  response: '📝 ',
  tools: '🔧 ',
  execution: '\u2699\uFE0F  ',
  compaction: '🗜 ',
  meta: 'ℹ️  ',
};

// Some fence language identifiers don't match highlight.js names.
// Map them so we get proper syntax colouring instead of a silent fallback.
const LANGUAGE_ALIASES: Record<string, string> = {
  jsonl: 'json',
};

export function getHighlighted(code: string, lang: string): string[] {
  const hlLang = LANGUAGE_ALIASES[lang] ?? lang;
  if (!supportsLanguage(hlLang)) {
    return code.split('\n');
  }
  try {
    return highlight(code, { language: hlLang, ignoreIllegals: true }).split('\n');
  } catch {
    return code.split('\n');
  }
}

/**
 * Render a block's content body: the body lines a block shows, identical in
 * Primary and History. Lays the content out via blockContentLines and paints the
 * code fences with getHighlighted — layout is shared (model/blockLayout), the
 * cli-highlight decoration stays here in the view.
 */
export function renderBlockContent(content: string, cols: number, indent: string = CONTENT_INDENT, markdown = false): string[] {
  return markdown ? markdownContentLines(content, cols, indent, getHighlighted) : blockContentLines(content, cols, indent, getHighlighted);
}

/** Whether a block renders as markdown: `response` blocks, when the flag is on. */
function blockRendersMarkdown(block: Block, markdown: MarkdownConfig | undefined): boolean {
  return markdown?.enabled === true && block.type === 'response';
}

export type DividerTimestamps = {
  createdAt: string;
  exitedAt?: string;
  duration?: string;
};

const TIME_FORMAT = DateTimeFormatter.ofPattern('HH:mm:ss');

function formatInstantToTime(instant: Instant): string {
  return instant.atZone(ZoneId.systemDefault()).toLocalTime().format(TIME_FORMAT);
}

export function blockTimestamps(createdAt: Instant | undefined, exitedAt: Instant | undefined): DividerTimestamps | undefined {
  if (!createdAt) {
    return undefined;
  }
  return {
    createdAt: formatInstantToTime(createdAt),
    exitedAt: exitedAt ? formatInstantToTime(exitedAt) : undefined,
    duration: exitedAt ? formatDuration(Duration.between(createdAt, exitedAt)) : undefined,
  };
}

type SealedRender = { cols: number; content: string; markdown: boolean; lines: string[] };
const sealedContentCache = new WeakMap<Block, SealedRender>();

/**
 * How often the active block's markdown is actually re-decorated (marked.lexer + cli-highlight), not
 * how often it repaints. Deltas between refreshes append as plain, undecorated text — instant, since
 * it's just a wrapLine call — and the next refresh replaces that raw tail with the properly rendered
 * version in one pass. Chosen as a period a human can't consciously tell apart from "instant" for a
 * few words appearing, while still capping decoration frequency for a fast token stream.
 */
const MARKDOWN_REFRESH_MS = 120;

type StreamingMarkdownCache = {
  cols: number;
  sealedRaw: string;
  sealedLines: string[];
  lastRunAt: number;
  decoratedContent: string;
  decoratedLines: string[];
  // True when decoratedLines' last entry is the still-open tail's last wrapped row — i.e. safe to
  // continue appending raw text onto. False when the tail was empty at decoration time (content ended
  // exactly at a sealed boundary), in which case the last entry is sealed content (e.g. a closing fence
  // line) that new text must never be glued onto.
  hasOpenLine: boolean;
};
const streamingMarkdownCache = new WeakMap<Block, StreamingMarkdownCache>();

/**
 * Render the active block's markdown without paying full decoration cost on every delta. Two
 * independent throttles stack here:
 *
 * 1. splitSealedTokens finds the last top-level `space` token (blank line) in the lexed content:
 *    marked's block tokenizer never reaches back across one to revise an earlier construct, so
 *    everything up to and including it is permanently sealed, however many more deltas arrive.
 *    Everything after it — the block currently being written — is re-rendered in full each time this
 *    runs, because within a still-open block nothing resolves monotonically (see
 *    markdownLayout.streaming-corruption.spec.ts).
 * 2. This function itself only runs the full lex-and-decorate pass once per MARKDOWN_REFRESH_MS. In
 *    between, new text is appended as plain, undecorated lines — instant, since it skips marked and
 *    cli-highlight entirely — so the transcript still grows on every keystroke-speed delta, it just
 *    displays raw for a moment before the next refresh replaces it with the decorated version. This is
 *    the render-cost throttle that used to live in ViewHost as a blanket render debounce; it is scoped
 *    to streaming markdown specifically so keystrokes and every other render source stay immediate.
 *
 * Keyed by block identity, like sealedContentCache; a fresh WeakMap entry per block means a new
 * response starts with no stale state from a previous one.
 */
function renderStreamingMarkdown(block: Block, cols: number, indent: string, now: number): string[] {
  const hit = streamingMarkdownCache.get(block);
  const dueForRefresh = !hit || hit.cols !== cols || now - hit.lastRunAt >= MARKDOWN_REFRESH_MS || !block.content.startsWith(hit.decoratedContent);

  if (!dueForRefresh && hit) {
    const rawTail = block.content.slice(hit.decoratedContent.length);
    if (rawTail.length === 0) {
      return hit.decoratedLines;
    }
    // The raw tail's first fragment (up to its first \n, or all of it if there's none) continues
    // whatever was already on the last decorated line — it must be concatenated and rewrapped, not
    // pushed as an independent line, or every refresh cycle breaks the line wherever the previous
    // decoration happened to end mid-word. Only fragments after an actual \n are genuinely new lines.
    const fragments = rawTail.split('\n');
    const lines = [...hit.decoratedLines];
    const firstFragment = fragments.shift() ?? '';
    if (hit.hasOpenLine && lines.length > 0) {
      const lastLine = lines.pop() ?? '';
      lines.push(...wrapLine(lastLine + firstFragment, cols));
    } else {
      lines.push(...wrapLine(indent + firstFragment, cols));
    }
    for (const fragment of fragments) {
      lines.push(...wrapLine(indent + fragment, cols));
    }
    return lines;
  }

  const { sealed, tail } = splitSealedTokens(block.content);
  const sealedRaw = sealed.map((t) => t.raw ?? '').join('');
  const sealedLines = hit && hit.cols === cols && hit.sealedRaw === sealedRaw ? hit.sealedLines : renderTokenLines(sealed, cols, indent, getHighlighted);
  const tailLines = renderTokenLines(tail, cols, indent, getHighlighted);
  const lines = [...sealedLines, ...tailLines];

  streamingMarkdownCache.set(block, { cols, sealedRaw, sealedLines, lastRunAt: now, decoratedContent: block.content, decoratedLines: lines, hasOpenLine: tailLines.length > 0 });
  return lines;
}

/**
 * Cached render of a sealed block's content. renderConversation repaints the whole transcript every
 * frame, and renderBlockContent runs cli-highlight per code fence — the dominant per-delta cost.
 * Exported so HistoryView shares the same cache instead of calling renderBlockContent directly: it
 * repaints on every navigation keypress, and every collapsed card re-ran full decoration only to
 * discard all but a handful of lines. `content` is passed explicitly (not read off `block.content`)
 * because a tools/execution block's collapsed preview renders its tool-name summary, not the block's
 * own content — a single cache slot per block is safe because a given block only ever renders one of
 * the two (see HistoryView's dispatch to #toolsCard vs #blockCard). Sealed blocks are immutable except
 * appendToLastSealed, which reassigns `content` to a new string, so the content-reference check catches
 * it. Keyed by block identity; the WeakMap drops entries when a block is gc'd (e.g.
 * ConversationState.clear()). The active streaming block is never cached.
 */
export function renderBlockContentCached(block: Block, content: string, cols: number, markdown: boolean): string[] {
  const indent = block.type === 'notice' ? '' : CONTENT_INDENT;
  const hit = sealedContentCache.get(block);
  if (hit && hit.cols === cols && hit.content === content && hit.markdown === markdown) {
    return hit.lines;
  }
  const lines = renderBlockContent(content, cols, indent, markdown);
  sealedContentCache.set(block, { cols, content, markdown, lines });
  return lines;
}

/**
 * Build a divider line with an optional centred label.
 *
 * - `null` → plain DIM fill (used as the separator between content area and status bar)
 * - non-null → "── label ── time" (used as block headers and the prompt divider)
 *
 * Labelled dividers pad to a fixed minimum width (MIN_DIVIDER_WIDTH), not the
 * terminal width: the unbounded, screen-width-dependent fill was the noise. A short
 * label still reaches the baseline so headers line up; a label already past the
 * minimum (e.g. with a long timestamp) gets no fill. The leading `──` marker stays.
 */
export function buildDivider(displayLabel: string | null, cols: number, timestamps?: DividerTimestamps): string {
  if (!displayLabel) {
    return DIM + FILL.repeat(cols) + RESET;
  }

  let line: string;
  if (timestamps) {
    const timeStr = timestamps.exitedAt ? `${timestamps.createdAt} \u2192 ${timestamps.exitedAt} (${timestamps.duration})` : timestamps.createdAt;
    line = `${FILL}${FILL} ${displayLabel} ${FILL}${FILL} ${timeStr} `;
  } else {
    line = `${FILL}${FILL} ${displayLabel} `;
  }

  const target = Math.min(MIN_DIVIDER_WIDTH, cols);
  const remaining = Math.max(0, target - stringWidth(line));
  return DIM + line + FILL.repeat(remaining) + RESET;
}

/**
 * Render conversation blocks into an array of display lines for the alt-buffer viewport.
 *
 * Returns sealed blocks + active streaming block. The caller (AppLayout) appends the
 * editor divider and editor lines when in editor mode, then slices to contentRows.
 */
export function renderConversation(state: ConversationState, cols: number, markdown?: MarkdownConfig): string[] {
  const allContent: string[] = [];
  const sealedBlocks = state.sealedBlocks;

  for (let i = 0; i < sealedBlocks.length; i++) {
    const block = sealedBlocks[i];
    if (!block) {
      continue;
    }
    // Consecutive blocks of the same type flow as one: skip header and gap for
    // continuations, suppress the trailing blank when the next block continues.
    const isContinuation = sealedBlocks[i - 1]?.type === block.type;
    const nextBlock = sealedBlocks[i + 1] ?? (i === sealedBlocks.length - 1 ? state.activeBlock : undefined);
    const hasNextContinuation = nextBlock?.type === block.type;

    if (!isContinuation && block.type !== 'notice') {
      const emoji = BLOCK_EMOJI[block.type] ?? '';
      const plain = BLOCK_PLAIN[block.type] ?? block.type;
      allContent.push(buildDivider(`${emoji}${plain}`, cols, blockTimestamps(block.createdAt, block.exitedAt)));
      allContent.push('');
    }
    allContent.push(...renderBlockContentCached(block, block.content, cols, blockRendersMarkdown(block, markdown)));
    if (!hasNextContinuation) {
      allContent.push('');
    }
  }

  if (state.activeBlock) {
    const lastSealed = sealedBlocks[sealedBlocks.length - 1];
    const isContinuation = lastSealed?.type === state.activeBlock.type;
    if (!isContinuation && state.activeBlock.type !== 'notice') {
      const activeEmoji = BLOCK_EMOJI[state.activeBlock.type] ?? '';
      const activePlain = BLOCK_PLAIN[state.activeBlock.type] ?? state.activeBlock.type;
      allContent.push(buildDivider(`${activeEmoji}${activePlain}`, cols, blockTimestamps(state.activeBlock.createdAt, undefined)));
      allContent.push('');
    }
    // Active block: emoji prefix on the first content line, indent on subsequent lines.
    // notice blocks render without indent (they're raw inline content).
    const activeEmoji = BLOCK_EMOJI[state.activeBlock.type] ?? '';
    const activeIndent = state.activeBlock.type === 'notice' ? '' : CONTENT_INDENT;
    // Streaming markdown is gated on its own flag; when off (or the flag is on but
    // streaming is off) the active block stays the raw per-delta render.
    const streamingMarkdown = blockRendersMarkdown(state.activeBlock, markdown) && markdown?.streaming === true;
    if (streamingMarkdown) {
      // markdownContentLines indents every line; swap the first line's indent for
      // the block emoji so the active block keeps its leading marker.
      const mdLines = renderStreamingMarkdown(state.activeBlock, cols, activeIndent, Date.now());
      if (mdLines.length > 0) {
        mdLines[0] = activeEmoji + mdLines[0].slice(activeIndent.length);
      }
      allContent.push(...mdLines);
    } else {
      const activeLines = state.activeBlock.content.split('\n');
      for (let i = 0; i < activeLines.length; i++) {
        const pfx = i === 0 ? activeEmoji : activeIndent;
        allContent.push(...wrapLine(pfx + (activeLines[i] ?? ''), cols));
      }
    }
  }

  return allContent;
}

/**
 * Render a slice of sealed blocks — from `startIndex` to the end of the array — into a
 * single string suitable for flushing to the terminal scroll buffer.
 *
 * Continuation checks reference the full array so headers are correctly suppressed for
 * consecutive same-type blocks even when the preceding block was already flushed.
 */
export function renderBlocksToString(allBlocks: ReadonlyArray<Block>, startIndex: number, cols: number, markdown?: MarkdownConfig): string {
  let out = '';
  for (let i = startIndex; i < allBlocks.length; i++) {
    const block = allBlocks[i];
    if (!block) {
      continue;
    }
    const isContinuation = allBlocks[i - 1]?.type === block.type;
    const hasNextContinuation = allBlocks[i + 1]?.type === block.type;
    if (!isContinuation && block.type !== 'notice') {
      const emoji = BLOCK_EMOJI[block.type] ?? '';
      const plain = BLOCK_PLAIN[block.type] ?? block.type;
      out += `${buildDivider(`${emoji}${plain}`, cols, blockTimestamps(block.createdAt, block.exitedAt))}\n\n`;
    }
    const blockIndent = block.type === 'notice' ? '' : CONTENT_INDENT;
    for (const line of renderBlockContent(block.content, cols, blockIndent, blockRendersMarkdown(block, markdown))) {
      out += `${line}\n`;
    }
    if (!hasNextContinuation) {
      out += '\n';
    }
  }
  return out;
}
