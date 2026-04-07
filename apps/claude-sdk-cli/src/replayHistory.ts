import type { Anthropic } from '@anthropic-ai/sdk';
import type { HistoryReplayConfig } from './cli-config/types.js';

// Subset of AppLayout's BlockType — meta is never produced during replay.
export type ReplayBlockType = 'prompt' | 'thinking' | 'response' | 'tools' | 'compaction';

export type ReplayBlock = {
  type: ReplayBlockType;
  content: string;
};

/**
 * Convert a stored message history into a flat list of display blocks.
 *
 * Pure function — no I/O, no AppLayout import. The caller pushes the result
 * into AppLayout.addHistoryBlocks().
 *
 * Mapping:
 *   user  text blocks          → prompt block
 *   user  tool_result blocks   → tools block  "↩ N results" (appended if tools block already open)
 *   asst  compaction block     → compaction block with summary text
 *   asst  text blocks          → response block
 *   asst  thinking blocks      → thinking block (only if opts.showThinking)
 *   asst  tool_use blocks      → tools block  "→ name"  (merged into running tools block)
 *
 * Content array is walked in order so text before tool calls appears in a
 * response block above the tools block, matching the live session display.
 */
export function replayHistory(messages: Anthropic.Beta.Messages.BetaMessageParam[], opts: Pick<HistoryReplayConfig, 'showThinking'>): ReplayBlock[] {
  const blocks: ReplayBlock[] = [];

  const appendToTools = (line: string): void => {
    const last = blocks[blocks.length - 1];
    if (last?.type === 'tools') {
      last.content += `\n${line}`;
    } else {
      blocks.push({ type: 'tools', content: line });
    }
  };

  for (const message of messages) {
    const content = Array.isArray(message.content) ? message.content : [{ type: 'text' as const, text: message.content as string }];

    if (message.role === 'user') {
      // Tool results — count only, name not available without cross-referencing tool_use ids.
      const resultCount = content.filter((b) => b.type === 'tool_result').length;
      if (resultCount > 0) {
        appendToTools(`↩ ${resultCount} result${resultCount === 1 ? '' : 's'}`);
        continue;
      }

      // Regular user text.
      const text = content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { type: 'text'; text: string }).text)
        .join('\n');
      if (text.trim()) {
        blocks.push({ type: 'prompt', content: text });
      }
    } else if (message.role === 'assistant') {
      // Walk content in order — text before tools matches live session display.
      for (const block of content) {
        if (block.type === 'text') {
          const text = (block as { type: 'text'; text: string }).text;
          if (text.trim()) {
            blocks.push({ type: 'response', content: text });
          }
        } else if (block.type === 'thinking') {
          if (opts.showThinking) {
            const thinking = (block as { type: 'thinking'; thinking: string }).thinking;
            if (thinking.trim()) {
              blocks.push({ type: 'thinking', content: thinking });
            }
          }
        } else if (block.type === 'tool_use') {
          const name = (block as { type: 'tool_use'; name: string }).name;
          appendToTools(`→ ${name}`);
        } else if (block.type === 'compaction') {
          const compaction = block as { type: 'compaction'; content: string };
          blocks.push({ type: 'compaction', content: compaction.content });
        }
      }
    }
  }

  return blocks;
}
