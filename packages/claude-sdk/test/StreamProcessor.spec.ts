import type { Anthropic } from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { StreamProcessor } from '../src/private/StreamProcessor.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function* makeStream(events: Anthropic.Beta.Messages.BetaRawMessageStreamEvent[]): AsyncIterable<Anthropic.Beta.Messages.BetaRawMessageStreamEvent> {
  yield* events;
}

const startCompaction: Anthropic.Beta.Messages.BetaRawMessageStreamEvent = {
  type: 'content_block_start',
  index: 0,
  content_block: { type: 'compaction', content: null },
};

const stopCompaction: Anthropic.Beta.Messages.BetaRawMessageStreamEvent = {
  type: 'content_block_stop',
  index: 0,
};

function deltaCompaction(content: string | null): Anthropic.Beta.Messages.BetaRawMessageStreamEvent {
  return { type: 'content_block_delta', index: 0, delta: { type: 'compaction_delta', content } };
}

// ---------------------------------------------------------------------------
// Single stream correctness (regression: behaves like MessageStream for one
// stream end-to-end).
// ---------------------------------------------------------------------------

describe('StreamProcessor — single stream correctness', () => {
  it('processes a compaction stream and returns the summary block', async () => {
    const processor = new StreamProcessor();
    const result = await processor.process(makeStream([startCompaction, deltaCompaction('First summary'), stopCompaction]));
    const block = result.blocks.find((b) => b.type === 'compaction') as { type: 'compaction'; content: string } | undefined;
    expect(block?.content).toBe('First summary');
  });

  it('emits compaction_complete with the summary text', async () => {
    const processor = new StreamProcessor();
    let emitted: string | undefined;
    processor.on('compaction_complete', (summary) => {
      emitted = summary;
    });
    await processor.process(makeStream([startCompaction, deltaCompaction('First summary'), stopCompaction]));
    expect(emitted).toBe('First summary');
  });
});

// ---------------------------------------------------------------------------
// Long-lived instance: the whole point of the refactor. The same instance
// must process multiple streams without leaking state between them, and
// subscriptions set once must fire for every stream.
// ---------------------------------------------------------------------------

describe('StreamProcessor — long-lived instance', () => {
  it('processes two streams on the same instance without leaking state', async () => {
    const processor = new StreamProcessor();

    const firstResult = await processor.process(makeStream([startCompaction, deltaCompaction('First summary'), stopCompaction]));
    const secondResult = await processor.process(makeStream([startCompaction, deltaCompaction('Second summary'), stopCompaction]));

    // First result has its own summary block only.
    expect(firstResult.blocks.length).toBe(1);
    const firstBlock = firstResult.blocks.find((b) => b.type === 'compaction') as { type: 'compaction'; content: string } | undefined;
    expect(firstBlock?.content).toBe('First summary');

    // Second result has its own summary block only; the first stream's block
    // did NOT carry over. If it had, secondResult.blocks would contain both.
    expect(secondResult.blocks.length).toBe(1);
    const secondBlock = secondResult.blocks.find((b) => b.type === 'compaction') as { type: 'compaction'; content: string } | undefined;
    expect(secondBlock?.content).toBe('Second summary');
  });

  it('fires `.on(...)` subscribers for every stream, subscribed once', async () => {
    const processor = new StreamProcessor();
    const summaries: string[] = [];
    processor.on('compaction_complete', (summary) => {
      summaries.push(summary);
    });

    await processor.process(makeStream([startCompaction, deltaCompaction('First'), stopCompaction]));
    await processor.process(makeStream([startCompaction, deltaCompaction('Second'), stopCompaction]));
    await processor.process(makeStream([startCompaction, deltaCompaction('Third'), stopCompaction]));

    expect(summaries).toEqual(['First', 'Second', 'Third']);
  });
});

// ---------------------------------------------------------------------------
// Server tool use: server_tool_use + web_fetch_tool_result blocks must be
// tracked (so content_block_stop doesn't warn) but not pushed to completed.
// Text generated after the tool result must still be captured.
// ---------------------------------------------------------------------------

describe('StreamProcessor — server tool use', () => {
  const serverToolUseStart: Anthropic.Beta.Messages.BetaRawMessageStreamEvent = {
    type: 'content_block_start',
    index: 0,
    content_block: {
      type: 'server_tool_use',
      id: 'srvtoolu_01RJsBbMt7mZuyXVAR9VVeiY',
      name: 'web_fetch',
      input: { url: 'https://www.anthropic.com/news/claude-opus-4-7' },
    } as unknown as Anthropic.Beta.Messages.BetaContentBlock,
  };

  const serverToolUseStop: Anthropic.Beta.Messages.BetaRawMessageStreamEvent = {
    type: 'content_block_stop',
    index: 0,
  };

  const webFetchResultStart: Anthropic.Beta.Messages.BetaRawMessageStreamEvent = {
    type: 'content_block_start',
    index: 1,
    content_block: {
      type: 'web_fetch_tool_result',
      tool_use_id: 'srvtoolu_01RJsBbMt7mZuyXVAR9VVeiY',
      content: { type: 'web_fetch_result', url: 'https://www.anthropic.com/news/claude-opus-4-7', retrieved_at: '2026-04-18T05:18:32.325000+00:00', content: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: 'Page content here' }, title: 'Introducing Claude Opus 4.7' } },
      caller: { type: 'direct' },
    } as unknown as Anthropic.Beta.Messages.BetaContentBlock,
  };

  const webFetchResultStop: Anthropic.Beta.Messages.BetaRawMessageStreamEvent = {
    type: 'content_block_stop',
    index: 1,
  };

  const textStart: Anthropic.Beta.Messages.BetaRawMessageStreamEvent = {
    type: 'content_block_start',
    index: 2,
    content_block: { type: 'text', text: '', citations: null },
  };

  const textDelta: Anthropic.Beta.Messages.BetaRawMessageStreamEvent = {
    type: 'content_block_delta',
    index: 2,
    delta: { type: 'text_delta', text: 'The fetch worked.' },
  };

  const textStop: Anthropic.Beta.Messages.BetaRawMessageStreamEvent = {
    type: 'content_block_stop',
    index: 2,
  };

  it('does not push server_tool_use or web_fetch_tool_result blocks to completed', async () => {
    const result = await new StreamProcessor().process(makeStream([serverToolUseStart, serverToolUseStop, webFetchResultStart, webFetchResultStop]));
    expect(result.blocks).toHaveLength(0);
  });

  it('yields exactly one block after server tool use', async () => {
    const result = await new StreamProcessor().process(makeStream([serverToolUseStart, serverToolUseStop, webFetchResultStart, webFetchResultStop, textStart, textDelta, textStop]));
    expect(result.blocks).toHaveLength(1);
  });

  it('the block after server tool use is the correct text content', async () => {
    const result = await new StreamProcessor().process(makeStream([serverToolUseStart, serverToolUseStop, webFetchResultStart, webFetchResultStop, textStart, textDelta, textStop]));
    expect(result.blocks[0]).toEqual({ type: 'text', text: 'The fetch worked.' });
  });

  it('unknown block types (e.g. redacted_thinking) do not emit server_tool_result', async () => {
    const redactedThinkingStart: Anthropic.Beta.Messages.BetaRawMessageStreamEvent = {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'redacted_thinking', data: 'encrypted' } as unknown as Anthropic.Beta.Messages.BetaContentBlock,
    };
    const redactedThinkingStop: Anthropic.Beta.Messages.BetaRawMessageStreamEvent = { type: 'content_block_stop', index: 0 };
    const emitted: string[] = [];
    const processor = new StreamProcessor();
    processor.on('server_tool_result', (name) => emitted.push(name));
    await processor.process(makeStream([redactedThinkingStart, redactedThinkingStop, textStart, textDelta, textStop]));
    expect(emitted).toHaveLength(0);
  });

  it('multiple server tool invocations in sequence do not corrupt state', async () => {
    const result = await new StreamProcessor().process(makeStream([serverToolUseStart, serverToolUseStop, webFetchResultStart, webFetchResultStop, serverToolUseStart, serverToolUseStop, webFetchResultStart, webFetchResultStop, textStart, textDelta, textStop]));
    expect(result.blocks[0]).toEqual({ type: 'text', text: 'The fetch worked.' });
  });

  it('emits server_tool_use with the tool name when a server_tool_use block completes', async () => {
    const processor = new StreamProcessor();
    const actual: string[] = [];
    processor.on('server_tool_use', (name) => actual.push(name));
    await processor.process(makeStream([serverToolUseStart, serverToolUseStop]));
    const expected = ['web_fetch'];
    expect(actual).toEqual(expected);
  });

  it('emits server_tool_result with the tool name when a server tool result block completes', async () => {
    const processor = new StreamProcessor();
    const actual: string[] = [];
    processor.on('server_tool_result', (name) => actual.push(name));
    await processor.process(makeStream([webFetchResultStart, webFetchResultStop]));
    const expected = ['web_fetch'];
    expect(actual).toEqual(expected);
  });
});
