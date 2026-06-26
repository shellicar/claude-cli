import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta.mjs';
import { ApiStreamError, safeJsonParse } from './errors';

export type SseFrame = { event: string | null; data: string };

/** Parses one SSE frame block (the text between two blank-line boundaries) into
 * its `event`/`data` fields. Returns null for an empty or comments-only block.
 * Exported for direct unit testing — this is foundational wire-parsing. */
export function parseFrame(block: string): SseFrame | null {
  let event: string | null = null;
  const dataLines: string[] = [];
  for (let line of block.split('\n')) {
    if (line.endsWith('\r')) {
      line = line.slice(0, -1);
    }
    if (line === '' || line.startsWith(':')) {
      continue;
    }
    const idx = line.indexOf(':');
    const field = idx === -1 ? line : line.slice(0, idx);
    let value = idx === -1 ? '' : line.slice(idx + 1);
    if (value.startsWith(' ')) {
      value = value.slice(1);
    }
    if (field === 'event') {
      event = value;
    } else if (field === 'data') {
      dataLines.push(value);
    }
  }
  if (event === null && dataLines.length === 0) {
    return null;
  }
  return { event, data: dataLines.join('\n') };
}

function handleFrame(frame: SseFrame): BetaRawMessageStreamEvent | null {
  if (frame.event === 'ping') {
    return null;
  }
  if (frame.event === 'error') {
    const body = safeJsonParse(frame.data) ?? frame.data;
    const type = typeof body === 'object' && body !== null ? (body as { error?: { type?: string } }).error?.type : undefined;
    throw new ApiStreamError(type, body);
  }
  return JSON.parse(frame.data) as BetaRawMessageStreamEvent;
}

/** Finds the first SSE frame boundary (`\n\n` or `\r\n\r\n`) in the buffer,
 * returning its index and delimiter length, or null when none is present.
 * Exported for direct unit testing — this is foundational wire-parsing. */
export function findFrameBoundary(buffer: string): { index: number; length: number } | null {
  const lf = buffer.indexOf('\n\n');
  const crlf = buffer.indexOf('\r\n\r\n');
  if (crlf !== -1 && (lf === -1 || crlf < lf)) {
    return { index: crlf, length: 4 };
  }
  if (lf !== -1) {
    return { index: lf, length: 2 };
  }
  return null;
}

/** Frames `body` into SSE events. Yields parsed message/content-block events,
 * skips `ping`, throws `ApiStreamError` on an `error` event. */
export async function* parseSse(body: ReadableStream<Uint8Array>, _signal?: AbortSignal): AsyncGenerator<BetaRawMessageStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let boundary = findFrameBoundary(buffer);
      while (boundary !== null) {
        const block = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary.length);
        const frame = parseFrame(block);
        if (frame) {
          const event = handleFrame(frame);
          if (event) {
            yield event;
          }
        }
        boundary = findFrameBoundary(buffer);
      }
    }
    // Flush a trailing frame that lacked a terminating blank line.
    if (buffer.trim().length > 0) {
      const frame = parseFrame(buffer);
      if (frame) {
        const event = handleFrame(frame);
        if (event) {
          yield event;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
