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
