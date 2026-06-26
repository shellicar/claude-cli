import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta.mjs';
import type { IMessageStream } from '../src/private/MessageStreamer.js';

// Minimal message_start with stub usage. BetaUsage has additional required
// fields (cache_creation, inference_geo, etc.) that are not needed for tests,
// so the cast bypasses the exhaustive type check.
const MESSAGE_START: BetaRawMessageStreamEvent = {
  type: 'message_start',
  message: {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    content: [],
    model: 'claude-test',
    stop_reason: null,
    stop_sequence: null,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  },
} as unknown as BetaRawMessageStreamEvent;

// Minimal message_delta that sets stop_reason and output_tokens.
const MESSAGE_DELTA: BetaRawMessageStreamEvent = {
  type: 'message_delta',
  delta: { stop_reason: 'end_turn', stop_sequence: null },
  usage: { output_tokens: 5 },
} as unknown as BetaRawMessageStreamEvent;

const MESSAGE_STOP: BetaRawMessageStreamEvent = { type: 'message_stop' };

/**
 * Wraps a list of content events with the message framing the accumulator
 * requires (a leading message_start and a trailing message_delta + message_stop).
 * StreamProcessor.spec.ts event arrays omit framing; TurnRunner.spec.ts and
 * QueryRunner.spec.ts drive the runners with fakes and do not need this wrapper.
 */
export function wrapWithMessageEnvelope(events: BetaRawMessageStreamEvent[]): BetaRawMessageStreamEvent[] {
  return [MESSAGE_START, ...events, MESSAGE_DELTA, MESSAGE_STOP];
}

/**
 * Builds an IMessageStream (an async iterable of raw stream events) from a
 * scripted event array — the owned boundary StreamProcessor.process consumes.
 */
export function makeRawStream(events: BetaRawMessageStreamEvent[]): IMessageStream {
  return (async function* () {
    for (const event of events) {
      yield event;
    }
  })();
}

/**
 * Like makeRawStream, but throws `error` after yielding every event — used to
 * exercise mid-stream error propagation out of process().
 */
export function makeThrowingStream(events: BetaRawMessageStreamEvent[], error: Error): IMessageStream {
  return (async function* () {
    for (const event of events) {
      yield event;
    }
    throw error;
  })();
}
