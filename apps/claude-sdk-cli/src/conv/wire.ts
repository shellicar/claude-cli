import { type Clock, OffsetDateTime } from '@js-joda/core';

/** Serialise a wire body to UTF-8 JSON bytes. The one place that frames a message, lifted from the tap. */
export const encode = (body: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(body));

/** Stamp the spec envelope `ts` (ISO-8601 with a real UTC offset) onto a body, then encode it. */
export const stamp = (clock: Clock, body: Record<string, unknown>): Uint8Array => encode({ ...body, ts: OffsetDateTime.now(clock).toString() });
