import type { Anthropic } from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { MessageStream } from '../src/private/MessageStream.js';

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
// Null compaction content
// ---------------------------------------------------------------------------

describe('MessageStream — null compaction content', () => {
  it('does not produce a compaction block in result.blocks', async () => {
    const stream = new MessageStream();
    const result = await stream.process(makeStream([startCompaction, deltaCompaction(null), stopCompaction]));
    const expected = false;
    const actual = result.blocks.some((b) => b.type === 'compaction');
    expect(actual).toBe(expected);
  });

  it('still emits compaction_complete with fallback message', async () => {
    const stream = new MessageStream();
    let emitted: string | undefined;
    stream.on('compaction_complete', (summary) => {
      emitted = summary;
    });
    await stream.process(makeStream([startCompaction, deltaCompaction(null), stopCompaction]));
    const expected = 'No compaction summary received';
    expect(emitted).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Valid compaction content
// ---------------------------------------------------------------------------

describe('MessageStream — valid compaction content', () => {
  it('produces a compaction block in result.blocks', async () => {
    const stream = new MessageStream();
    const result = await stream.process(makeStream([startCompaction, deltaCompaction('Session summary'), stopCompaction]));
    const expected = true;
    const actual = result.blocks.some((b) => b.type === 'compaction');
    expect(actual).toBe(expected);
  });

  it('compaction block carries the summary text', async () => {
    const stream = new MessageStream();
    const result = await stream.process(makeStream([startCompaction, deltaCompaction('Session summary'), stopCompaction]));
    const block = result.blocks.find((b) => b.type === 'compaction') as { type: 'compaction'; content: string } | undefined;
    const expected = 'Session summary';
    expect(block?.content).toBe(expected);
  });

  it('emits compaction_complete with the summary text', async () => {
    const stream = new MessageStream();
    let emitted: string | undefined;
    stream.on('compaction_complete', (summary) => {
      emitted = summary;
    });
    await stream.process(makeStream([startCompaction, deltaCompaction('Session summary'), stopCompaction]));
    const expected = 'Session summary';
    expect(emitted).toBe(expected);
  });
});
