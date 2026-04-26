import { BetaMessageStream } from '@anthropic-ai/sdk/lib/BetaMessageStream.mjs';
import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta.mjs';

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
 * Wraps a list of content events with the message framing that
 * BetaMessageStream.fromReadableStream requires. StreamProcessor.spec.ts
 * event arrays omit framing; TurnRunner.spec.ts and QueryRunner.spec.ts
 * include it in their own helpers and do not need this wrapper.
 */
export function wrapWithMessageEnvelope(events: BetaRawMessageStreamEvent[]): BetaRawMessageStreamEvent[] {
  return [MESSAGE_START, ...events, MESSAGE_DELTA, MESSAGE_STOP];
}

/**
 * Creates a BetaMessageStream from a scripted event array. Must be called
 * lazily — at the moment the stream is handed to StreamProcessor.process() —
 * so that process() registers its listeners before any events fire.
 *
 * BetaMessageStream.fromReadableStream starts _run synchronously, but the
 * executor suspends at the first `for await` on the ReadableStream. Listener
 * registration in process() happens before that suspension resolves.
 */
export function makeBetaStream(events: BetaRawMessageStreamEvent[]): BetaMessageStream {
  const lines = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(lines));
      controller.close();
    },
  });
  return BetaMessageStream.fromReadableStream(readable);
}
