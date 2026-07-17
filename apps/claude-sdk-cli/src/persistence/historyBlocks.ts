import type { BetaContentBlock, BetaContentBlockParam, BetaToolResultBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages.js';
import type { HistoryBlock } from '@shellicar/claude-core/history/types';

/**
 * Turn a message's content into the store's blocks. Content reaches here in either Anthropic shape — a bare string
 * (a user send) or an array of content blocks (an assistant response, or a structured user message) — and each block
 * keeps its raw `type`; the searchable `text` is pulled out per type, or `null` when the block carries none.
 *
 * Shared by the ingest (parsing audit lines) and, from Phase 2, the live writer, so a message indexes the same way
 * however it reaches the store.
 */
export function toHistoryBlocks(content: string | readonly BetaContentBlockParam[] | readonly BetaContentBlock[]): HistoryBlock[] {
  if (typeof content === 'string') {
    return content.length === 0 ? [] : [{ seq: 0, type: 'text', text: content }];
  }
  return content.map((block, seq) => ({ seq, type: block.type, text: blockText(block) }));
}

function blockText(block: BetaContentBlock | BetaContentBlockParam): string | null {
  switch (block.type) {
    case 'text':
      return block.text;
    case 'thinking':
      return block.thinking;
    // A tool call has no prose; its name and arguments are the searchable text (down-ranked by §6, still findable).
    case 'tool_use':
      return `${block.name} ${JSON.stringify(block.input)}`;
    case 'tool_result':
      return toolResultText(block.content);
    // Other block types (images, redacted thinking, server tool use) carry no plain text to index; the block is
    // still stored with its type, just not mirrored into the full-text index.
    default:
      return null;
  }
}

function toolResultText(content: BetaToolResultBlockParam['content']): string | null {
  if (content === undefined) {
    return null;
  }
  if (typeof content === 'string') {
    return content;
  }
  const texts = content.filter((part) => part.type === 'text').map((part) => part.text);
  return texts.length === 0 ? null : texts.join('\n');
}
