import { DIM, RESET } from '@shellicar/claude-core/ansi';
import { wrapLine } from '@shellicar/claude-core/reflow';
import { highlight, supportsLanguage } from 'cli-highlight';
import type { Block, ConversationState } from '../model/ConversationState.js';

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

const CODE_FENCE_RE = /```(\w*)\n([\s\S]*?)```/g;

// Some fence language identifiers don't match highlight.js names.
// Map them so we get proper syntax colouring instead of a silent fallback.
const LANGUAGE_ALIASES: Record<string, string> = {
  jsonl: 'json',
};

function getHighlighted(code: string, lang: string): string[] {
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

function renderBlockContent(content: string, cols: number): string[] {
  const result: string[] = [];
  let lastIndex = 0;

  const addText = (text: string) => {
    const lines = text.split('\n');
    const trimmed = lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines;
    for (const line of trimmed) {
      result.push(...wrapLine(CONTENT_INDENT + line, cols));
    }
  };

  for (const match of content.matchAll(CODE_FENCE_RE)) {
    if (match.index > lastIndex) {
      addText(content.slice(lastIndex, match.index));
    }
    const lang = match[1] || 'plaintext';
    const code = (match[2] ?? '').trimEnd();
    result.push(`${CONTENT_INDENT}\`\`\`${lang}`);
    for (const line of getHighlighted(code, lang)) {
      result.push(CONTENT_INDENT + line);
    }
    result.push(`${CONTENT_INDENT}\`\`\``);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    addText(content.slice(lastIndex));
  } else if (lastIndex === 0) {
    addText(content);
  }

  return result;
}

/**
 * Build a divider line with an optional centred label.
 *
 * - `null` → plain DIM fill (used as the separator between content area and status bar)
 * - non-null → "── label ────────" (used as block headers and the prompt divider)
 */
export function buildDivider(displayLabel: string | null, cols: number): string {
  if (!displayLabel) {
    return DIM + FILL.repeat(cols) + RESET;
  }
  const prefix = `${FILL}${FILL} ${displayLabel} `;
  const remaining = Math.max(0, cols - prefix.length);
  return DIM + prefix + FILL.repeat(remaining) + RESET;
}

/**
 * Render conversation blocks into an array of display lines for the alt-buffer viewport.
 *
 * Returns sealed blocks + active streaming block. The caller (AppLayout) appends the
 * editor divider and editor lines when in editor mode, then slices to contentRows.
 */
export function renderConversation(state: ConversationState, cols: number): string[] {
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

    if (!isContinuation) {
      const emoji = BLOCK_EMOJI[block.type] ?? '';
      const plain = BLOCK_PLAIN[block.type] ?? block.type;
      allContent.push(buildDivider(`${emoji}${plain}`, cols));
      allContent.push('');
    }
    allContent.push(...renderBlockContent(block.content, cols));
    if (!hasNextContinuation) {
      allContent.push('');
    }
  }

  if (state.activeBlock) {
    const lastSealed = sealedBlocks[sealedBlocks.length - 1];
    const isContinuation = lastSealed?.type === state.activeBlock.type;
    if (!isContinuation) {
      const activeEmoji = BLOCK_EMOJI[state.activeBlock.type] ?? '';
      const activePlain = BLOCK_PLAIN[state.activeBlock.type] ?? state.activeBlock.type;
      allContent.push(buildDivider(`${activeEmoji}${activePlain}`, cols));
      allContent.push('');
    }
    // Active block: emoji prefix on the first content line, indent on subsequent lines.
    // This gives the streaming-in-progress visual effect.
    const activeEmoji = BLOCK_EMOJI[state.activeBlock.type] ?? '';
    const activeLines = state.activeBlock.content.split('\n');
    for (let i = 0; i < activeLines.length; i++) {
      const pfx = i === 0 ? activeEmoji : CONTENT_INDENT;
      allContent.push(...wrapLine(pfx + (activeLines[i] ?? ''), cols));
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
export function renderBlocksToString(allBlocks: ReadonlyArray<Block>, startIndex: number, cols: number): string {
  let out = '';
  for (let i = startIndex; i < allBlocks.length; i++) {
    const block = allBlocks[i];
    if (!block) {
      continue;
    }
    const isContinuation = allBlocks[i - 1]?.type === block.type;
    const hasNextContinuation = allBlocks[i + 1]?.type === block.type;
    if (!isContinuation) {
      const emoji = BLOCK_EMOJI[block.type] ?? '';
      const plain = BLOCK_PLAIN[block.type] ?? block.type;
      out += `${buildDivider(`${emoji}${plain}`, cols)}\n\n`;
    }
    for (const line of renderBlockContent(block.content, cols)) {
      out += `${line}\n`;
    }
    if (!hasNextContinuation) {
      out += '\n';
    }
  }
  return out;
}
