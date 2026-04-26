import type { BetaContentBlock, BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta.mjs';
import { describe, expect, it } from 'vitest';
import { StreamProcessor } from '../src/private/StreamProcessor.js';
import { makeBetaStream, wrapWithMessageEnvelope } from './helpers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const startCompaction: BetaRawMessageStreamEvent = {
  type: 'content_block_start',
  index: 0,
  content_block: { type: 'compaction', content: null },
};

const stopCompaction: BetaRawMessageStreamEvent = {
  type: 'content_block_stop',
  index: 0,
};

function deltaCompaction(content: string | null): BetaRawMessageStreamEvent {
  return { type: 'content_block_delta', index: 0, delta: { type: 'compaction_delta', content } };
}

// ---------------------------------------------------------------------------
// Single stream correctness (regression: behaves like MessageStream for one
// stream end-to-end).
// ---------------------------------------------------------------------------

describe('StreamProcessor — single stream correctness', () => {
  it('processes a compaction stream and returns the summary block', async () => {
    const processor = new StreamProcessor();
    const result = await processor.process(makeBetaStream(wrapWithMessageEnvelope([startCompaction, deltaCompaction('First summary'), stopCompaction])));
    const block = result.blocks.find((b) => b.type === 'compaction') as { type: 'compaction'; content: string } | undefined;
    expect(block?.content).toBe('First summary');
  });

  it('emits compaction_complete with the summary text', async () => {
    const processor = new StreamProcessor();
    let emitted: string | undefined;
    processor.on('compaction_complete', (summary) => {
      emitted = summary;
    });
    await processor.process(makeBetaStream(wrapWithMessageEnvelope([startCompaction, deltaCompaction('First summary'), stopCompaction])));
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

    const firstResult = await processor.process(makeBetaStream(wrapWithMessageEnvelope([startCompaction, deltaCompaction('First summary'), stopCompaction])));
    const secondResult = await processor.process(makeBetaStream(wrapWithMessageEnvelope([startCompaction, deltaCompaction('Second summary'), stopCompaction])));

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

    await processor.process(makeBetaStream(wrapWithMessageEnvelope([startCompaction, deltaCompaction('First'), stopCompaction])));
    await processor.process(makeBetaStream(wrapWithMessageEnvelope([startCompaction, deltaCompaction('Second'), stopCompaction])));
    await processor.process(makeBetaStream(wrapWithMessageEnvelope([startCompaction, deltaCompaction('Third'), stopCompaction])));

    expect(summaries).toEqual(['First', 'Second', 'Third']);
  });
});

// ---------------------------------------------------------------------------
// Server tool use: server_tool_use + web_fetch_tool_result blocks must be
// tracked (so content_block_stop doesn't warn) but not pushed to completed.
// Text generated after the tool result must still be captured.
// ---------------------------------------------------------------------------

describe('StreamProcessor — server tool use', () => {
  const serverToolUseStart: BetaRawMessageStreamEvent = {
    type: 'content_block_start',
    index: 0,
    content_block: {
      type: 'server_tool_use',
      id: 'srvtoolu_01RJsBbMt7mZuyXVAR9VVeiY',
      name: 'web_fetch',
      input: { url: 'https://www.anthropic.com/news/claude-opus-4-7' },
    } as unknown as BetaContentBlock,
  };

  const serverToolUseStop: BetaRawMessageStreamEvent = {
    type: 'content_block_stop',
    index: 0,
  };

  const webFetchResultStart: BetaRawMessageStreamEvent = {
    type: 'content_block_start',
    index: 1,
    content_block: {
      type: 'web_fetch_tool_result',
      tool_use_id: 'srvtoolu_01RJsBbMt7mZuyXVAR9VVeiY',
      content: { type: 'web_fetch_result', url: 'https://www.anthropic.com/news/claude-opus-4-7', retrieved_at: '2026-04-18T05:18:32.325000+00:00', content: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: 'Page content here' }, title: 'Introducing Claude Opus 4.7' } },
      caller: { type: 'direct' },
    } as unknown as BetaContentBlock,
  };

  const webFetchResultStop: BetaRawMessageStreamEvent = {
    type: 'content_block_stop',
    index: 1,
  };

  const textStart: BetaRawMessageStreamEvent = {
    type: 'content_block_start',
    index: 2,
    content_block: { type: 'text', text: '', citations: null },
  };

  const textDelta: BetaRawMessageStreamEvent = {
    type: 'content_block_delta',
    index: 2,
    delta: { type: 'text_delta', text: 'The fetch worked.' },
  };

  const textStop: BetaRawMessageStreamEvent = {
    type: 'content_block_stop',
    index: 2,
  };

  it('does not push server_tool_use or web_fetch_tool_result blocks to completed', async () => {
    const result = await new StreamProcessor().process(makeBetaStream(wrapWithMessageEnvelope([serverToolUseStart, serverToolUseStop, webFetchResultStart, webFetchResultStop])));
    expect(result.blocks).toHaveLength(2);
  });

  it('yields exactly three blocks after server tool use', async () => {
    const result = await new StreamProcessor().process(makeBetaStream(wrapWithMessageEnvelope([serverToolUseStart, serverToolUseStop, webFetchResultStart, webFetchResultStop, textStart, textDelta, textStop])));
    expect(result.blocks).toHaveLength(3);
  });

  it('the block after server tool use is the correct text content', async () => {
    const result = await new StreamProcessor().process(makeBetaStream(wrapWithMessageEnvelope([serverToolUseStart, serverToolUseStop, webFetchResultStart, webFetchResultStop, textStart, textDelta, textStop])));
    expect(result.blocks[2]).toEqual({ type: 'text', text: 'The fetch worked.' });
  });

  it('unknown block types (e.g. redacted_thinking) do not emit server_tool_result', async () => {
    const redactedThinkingStart: BetaRawMessageStreamEvent = {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'redacted_thinking', data: 'encrypted' },
    };
    const redactedThinkingStop: BetaRawMessageStreamEvent = { type: 'content_block_stop', index: 0 };
    const emitted: string[] = [];
    const processor = new StreamProcessor();
    processor.on('server_tool_result', (name) => emitted.push(name));
    await processor.process(makeBetaStream(wrapWithMessageEnvelope([redactedThinkingStart, redactedThinkingStop, textStart, textDelta, textStop])));
    expect(emitted).toHaveLength(0);
  });

  it('multiple server tool invocations in sequence do not corrupt state', async () => {
    // The SDK accumulates blocks by push order, not by event.index. Deltas use
    // event.index to find the block to update. To avoid index mismatch (which
    // silently drops deltas), the second server tool pair and the final text
    // block use sequential indices (2, 3, 4) rather than reusing 0, 1, 2.
    const serverToolUseStart2: BetaRawMessageStreamEvent = {
      type: 'content_block_start',
      index: 2,
      content_block: {
        type: 'server_tool_use',
        id: 'srvtoolu_02',
        name: 'web_fetch',
        input: { url: 'https://www.anthropic.com/news/claude-opus-4-7' },
      } as unknown as BetaContentBlock,
    };
    const serverToolUseStop2: BetaRawMessageStreamEvent = { type: 'content_block_stop', index: 2 };
    const webFetchResultStart2: BetaRawMessageStreamEvent = {
      type: 'content_block_start',
      index: 3,
      content_block: {
        type: 'web_fetch_tool_result',
        tool_use_id: 'srvtoolu_02',
        content: { type: 'web_fetch_result', url: 'https://www.anthropic.com/news/claude-opus-4-7', retrieved_at: '2026-04-18T05:18:32.325000+00:00', content: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: 'Page content here' }, title: 'Introducing Claude Opus 4.7' } },
        caller: { type: 'direct' },
      } as unknown as BetaContentBlock,
    };
    const webFetchResultStop2: BetaRawMessageStreamEvent = { type: 'content_block_stop', index: 3 };
    const textStart4: BetaRawMessageStreamEvent = {
      type: 'content_block_start',
      index: 4,
      content_block: { type: 'text', text: '', citations: null },
    };
    const textDelta4: BetaRawMessageStreamEvent = {
      type: 'content_block_delta',
      index: 4,
      delta: { type: 'text_delta', text: 'The fetch worked.' },
    };
    const textStop4: BetaRawMessageStreamEvent = { type: 'content_block_stop', index: 4 };

    const result = await new StreamProcessor().process(
      makeBetaStream(
        wrapWithMessageEnvelope([
          serverToolUseStart, serverToolUseStop,
          webFetchResultStart, webFetchResultStop,
          serverToolUseStart2, serverToolUseStop2,
          webFetchResultStart2, webFetchResultStop2,
          textStart4, textDelta4, textStop4,
        ]),
      ),
    );
    expect(result.blocks[4]).toEqual({ type: 'text', text: 'The fetch worked.' });
  });

  it('emits server_tool_use with the tool name when a server_tool_use block completes', async () => {
    const processor = new StreamProcessor();
    const actual: string[] = [];
    processor.on('server_tool_use', (name) => actual.push(name));
    await processor.process(makeBetaStream(wrapWithMessageEnvelope([serverToolUseStart, serverToolUseStop])));
    const expected = ['web_fetch'];
    expect(actual).toEqual(expected);
  });

  it('emits server_tool_result with the tool name when a server tool result block completes', async () => {
    const processor = new StreamProcessor();
    const actual: string[] = [];
    processor.on('server_tool_result', (name) => actual.push(name));
    await processor.process(makeBetaStream(wrapWithMessageEnvelope([webFetchResultStart, webFetchResultStop])));
    const expected = ['web_fetch'];
    expect(actual).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// Conversation integrity: a full web-search response must preserve all blocks
// in completed — thinking, text, server_tool_use, and web_search_tool_result.
// ---------------------------------------------------------------------------

describe('StreamProcessor — conversation integrity', () => {
  const thinkingStart1: BetaRawMessageStreamEvent = {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'thinking', thinking: '', signature: '' },
  };
  const thinkingDelta1: BetaRawMessageStreamEvent = {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'thinking_delta', thinking: 'Let me search.' },
  };
  const signatureDelta1: BetaRawMessageStreamEvent = {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'signature_delta', signature: 'sig1' },
  };
  const thinkingStop1: BetaRawMessageStreamEvent = {
    type: 'content_block_stop',
    index: 0,
  };
  const textStart1: BetaRawMessageStreamEvent = {
    type: 'content_block_start',
    index: 1,
    content_block: { type: 'text', text: '', citations: null },
  };
  const textDelta1: BetaRawMessageStreamEvent = {
    type: 'content_block_delta',
    index: 1,
    delta: { type: 'text_delta', text: 'I will search for that.' },
  };
  const textStop1: BetaRawMessageStreamEvent = {
    type: 'content_block_stop',
    index: 1,
  };
  const webSearchUseStart: BetaRawMessageStreamEvent = {
    type: 'content_block_start',
    index: 2,
    content_block: {
      type: 'server_tool_use',
      id: 'srvtoolu_webSearch01',
      name: 'web_search',
      input: {},
    } as unknown as BetaContentBlock,
  };
  const webSearchUseStop: BetaRawMessageStreamEvent = {
    type: 'content_block_stop',
    index: 2,
  };
  const webSearchResultStart: BetaRawMessageStreamEvent = {
    type: 'content_block_start',
    index: 3,
    content_block: {
      type: 'web_search_tool_result',
      tool_use_id: 'srvtoolu_webSearch01',
      content: [],
    } as unknown as BetaContentBlock,
  };
  const webSearchResultStop: BetaRawMessageStreamEvent = {
    type: 'content_block_stop',
    index: 3,
  };
  const thinkingStart2: BetaRawMessageStreamEvent = {
    type: 'content_block_start',
    index: 4,
    content_block: { type: 'thinking', thinking: '', signature: '' },
  };
  const thinkingDelta2: BetaRawMessageStreamEvent = {
    type: 'content_block_delta',
    index: 4,
    delta: { type: 'thinking_delta', thinking: 'Found the results.' },
  };
  const signatureDelta2: BetaRawMessageStreamEvent = {
    type: 'content_block_delta',
    index: 4,
    delta: { type: 'signature_delta', signature: 'sig2' },
  };
  const thinkingStop2: BetaRawMessageStreamEvent = {
    type: 'content_block_stop',
    index: 4,
  };
  const textStart2: BetaRawMessageStreamEvent = {
    type: 'content_block_start',
    index: 5,
    content_block: { type: 'text', text: '', citations: null },
  };
  const textDelta2: BetaRawMessageStreamEvent = {
    type: 'content_block_delta',
    index: 5,
    delta: { type: 'text_delta', text: 'Here are the results.' },
  };
  const textStop2: BetaRawMessageStreamEvent = {
    type: 'content_block_stop',
    index: 5,
  };

  const webSearchResponseStream = [thinkingStart1, thinkingDelta1, signatureDelta1, thinkingStop1, textStart1, textDelta1, textStop1, webSearchUseStart, webSearchUseStop, webSearchResultStart, webSearchResultStop, thinkingStart2, thinkingDelta2, signatureDelta2, thinkingStop2, textStart2, textDelta2, textStop2];

  it('result.blocks contains all six blocks from a web-search response', async () => {
    const result = await new StreamProcessor().process(makeBetaStream(wrapWithMessageEnvelope(webSearchResponseStream)));
    const expected = 6;
    const actual = result.blocks.length;
    expect(actual).toBe(expected);
  });

  it('blocks appear in the order emitted by the API', async () => {
    const result = await new StreamProcessor().process(makeBetaStream(wrapWithMessageEnvelope(webSearchResponseStream)));
    const expected = ['thinking', 'text', 'server_tool_use', 'web_search_tool_result', 'thinking', 'text'];
    const actual = result.blocks.map((b) => b.type);
    expect(actual).toEqual(expected);
  });

  it('redacted_thinking block appears in completed', async () => {
    const redactedThinkingStart: BetaRawMessageStreamEvent = {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'redacted_thinking', data: 'encrypted-payload' },
    };
    const redactedThinkingStop: BetaRawMessageStreamEvent = { type: 'content_block_stop', index: 0 };
    const result = await new StreamProcessor().process(makeBetaStream(wrapWithMessageEnvelope([redactedThinkingStart, redactedThinkingStop])));
    const expected = 1;
    const actual = result.blocks.length;
    expect(actual).toBe(expected);
  });
});
