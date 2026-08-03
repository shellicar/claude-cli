const HEADER_END = Buffer.from('\r\n\r\n', 'utf8');

/** A header is a couple of short lines. Anything approaching this is not a header, and waiting for
 *  its terminator would grow the buffer without limit. */
const MAX_HEADER_BYTES = 8 * 1024;

/** A tsserver reply is a JSON document; this is far above any real one. A declared length beyond it
 *  is a corrupt frame, and honouring it would mean holding that much before discovering so. */
const MAX_BODY_BYTES = 64 * 1024 * 1024;

/**
 * tsserver frames every message as `Content-Length: N\r\n\r\n{json}`, where N counts bytes.
 *
 * So the buffer is bytes throughout, and only a complete body is ever decoded. Accumulating the
 * stream as a string instead is subtly wrong and was: a JavaScript string's length counts UTF-16
 * units, so one em dash in a symbol's documentation made the declared length exceed everything
 * the reader could see, and it waited for bytes it was already holding until the caller timed out.
 *
 * Kept apart from the client that spawns the process so the framing can be exercised on its own,
 * without a real tsserver.
 */
export class FrameReader {
  #buffer: Buffer = Buffer.alloc(0);

  public reset(): void {
    this.#buffer = Buffer.alloc(0);
  }

  /** Everything that has become a complete message with this chunk. */
  public push(chunk: Buffer): unknown[] {
    this.#buffer = this.#buffer.length === 0 ? chunk : Buffer.concat([this.#buffer, chunk]);
    const messages: unknown[] = [];
    while (true) {
      const headerEnd = this.#buffer.indexOf(HEADER_END);
      if (headerEnd === -1) {
        if (this.#buffer.length > MAX_HEADER_BYTES) {
          // Not a header. Keeping it would grow forever waiting for a terminator that isn't coming.
          this.reset();
        }
        break;
      }
      const header = this.#buffer.subarray(0, headerEnd).toString('utf8');
      const match = header.match(/Content-Length:\s*(\d+)/);
      if (match?.[1] == null) {
        this.#buffer = this.#buffer.subarray(headerEnd + HEADER_END.length);
        continue;
      }
      const contentLength = Number.parseInt(match[1], 10);
      if (contentLength > MAX_BODY_BYTES) {
        this.reset();
        break;
      }
      const bodyStart = headerEnd + HEADER_END.length;
      if (this.#buffer.length < bodyStart + contentLength) {
        break;
      }
      const body = this.#buffer.subarray(bodyStart, bodyStart + contentLength).toString('utf8');
      this.#buffer = this.#buffer.subarray(bodyStart + contentLength);
      try {
        messages.push(JSON.parse(body));
      } catch {
        // A body that isn't JSON is not something a caller can act on; the next frame still parses.
      }
    }
    return messages;
  }
}
