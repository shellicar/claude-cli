import { DateTimeFormatter, Duration, type Instant, ZoneId } from '@js-joda/core';
import { DIM, RESET } from '@shellicar/claude-core/ansi';
import { wrapLine } from '@shellicar/claude-core/reflow';
import { highlight, supportsLanguage } from 'cli-highlight';
import stringWidth from 'string-width';
import type { MarkdownConfig } from '../cli-config/types.js';
import { blockContentLines } from '../model/blockLayout.js';
import type { Block, ConversationState } from '../model/ConversationState.js';
import { markdownContentLines } from '../model/markdown/markdownLayout.js';
import { formatDuration } from './formatDuration.js';

const FILL = '\u2500';

const BLOCK_PLAIN: Record<string, string> = {
  prompt: 'prompt',
  thinking: 'thinking',
  response: 'response',
  tools: 'tools',
  compaction: 'compaction',
  meta: 'query',
};

const BLOCK_EMOJI: Record<string, string> = {
  prompt: '💬 ',
  thinking: '💭 ',
  response: '📝 ',
  tools: '🔧 ',
  compaction: '🗜 ',
  meta: 'ℹ️  ',
};

const CONTENT_INDENT = '   ';

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

function blockTimestamps(createdAt: Instant | undefined, exitedAt: Instant | undefined): DividerTimestamps | undefined {
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
 * Cached render of a sealed block's content. renderConversation repaints the whole
 * transcript every frame, and renderBlockContent runs cli-highlight per code fence —
 * the dominant per-delta cost. Sealed blocks are immutable except appendToLastSealed,
 * which reassigns `content` to a new string, so the content-reference check catches it.
 * Keyed by block identity; the WeakMap drops entries when a block is gc'd (e.g.
 * ConversationState.clear()). The active streaming block is never cached.
 */
function renderBlockContentCached(block: Block, cols: number, markdown: boolean): string[] {
  const indent = block.type === 'notice' ? '' : CONTENT_INDENT;
  const hit = sealedContentCache.get(block);
  if (hit && hit.cols === cols && hit.content === block.content && hit.markdown === markdown) {
    return hit.lines;
  }
  const lines = renderBlockContent(block.content, cols, indent, markdown);
  sealedContentCache.set(block, { cols, content: block.content, markdown, lines });
  return lines;
}

/**
 * Build a divider line with an optional centred label.
 *
 * - `null` → plain DIM fill (used as the separator between content area and status bar)
 * - non-null → "── label ────────" (used as block headers and the prompt divider)
 */
export function buildDivider(displayLabel: string | null, cols: number, timestamps?: DividerTimestamps): string {
  if (!displayLabel) {
    return DIM + FILL.repeat(cols) + RESET;
  }

  let prefix: string;
  if (timestamps) {
    const timeStr = timestamps.exitedAt ? `${timestamps.createdAt} \u2192 ${timestamps.exitedAt} (${timestamps.duration})` : timestamps.createdAt;
    prefix = `${FILL}${FILL} ${displayLabel} ${FILL}${FILL} ${timeStr} `;
  } else {
    prefix = `${FILL}${FILL} ${displayLabel} `;
  }

  const remaining = Math.max(0, cols - stringWidth(prefix));
  return DIM + prefix + FILL.repeat(remaining) + RESET;
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
    allContent.push(...renderBlockContentCached(block, cols, blockRendersMarkdown(block, markdown)));
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
      const mdLines = markdownContentLines(state.activeBlock.content, cols, activeIndent, getHighlighted);
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
