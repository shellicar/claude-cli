import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta.mjs';

export type SseFrame = { event: string | null; data: string };

/** Parses one SSE frame block (the text between two blank-line boundaries) into
 * its `event`/`data` fields. Returns null for an empty or comments-only block.
 * Exported for direct unit testing — this is foundational wire-parsing. */
export function parseFrame(_block: string): SseFrame | null {
  throw new Error('not implemented');
}

/** Finds the first SSE frame boundary (`\n\n` or `\r\n\r\n`) in the buffer,
 * returning its index and delimiter length, or null when none is present.
 * Exported for direct unit testing — this is foundational wire-parsing. */
export function findFrameBoundary(_buffer: string): { index: number; length: number } | null {
  throw new Error('not implemented');
}

/** Frames `body` into SSE events. Yields parsed message/content-block events,
 * skips `ping`, throws `ApiStreamError` on an `error` event. */
export async function* parseSse(_body: ReadableStream<Uint8Array>, _signal?: AbortSignal): AsyncGenerator<BetaRawMessageStreamEvent> {
  throw new Error('not implemented');
}
