import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { drainToString } from '../src/fromStream.js';

// No process and no disk: a bounded drain is about what it keeps and what it consumes, and both
// are observable from a plain readable.

const streamOf = (...parts: string[]): Readable => Readable.from(parts.map((part) => Buffer.from(part)));

describe('drainToString within the limit', () => {
  it('keeps everything', async () => {
    const expected = 'abcdef';
    const { text } = await drainToString(streamOf('abc', 'def'), 100);
    expect(text).toBe(expected);
  });

  it('is not marked truncated', async () => {
    const expected = false;
    const { truncated } = await drainToString(streamOf('abc', 'def'), 100);
    expect(truncated).toBe(expected);
  });
});

describe('drainToString past the limit', () => {
  it('keeps exactly the limit', async () => {
    const expected = 'abcd';
    const { text } = await drainToString(streamOf('abc', 'def'), 4);
    expect(text).toBe(expected);
  });

  it('is marked truncated', async () => {
    const expected = true;
    const { truncated } = await drainToString(streamOf('abc', 'def'), 4);
    expect(truncated).toBe(expected);
  });

  // The count is what makes the truncation honest rather than a silently short result, and it
  // only exists because reading continued past the limit instead of stopping.
  it('reports every byte the stream produced, not just the kept ones', async () => {
    const expected = 6;
    const { bytes } = await drainToString(streamOf('abc', 'def'), 4);
    expect(bytes).toBe(expected);
  });

  it('drains the stream to the end', async () => {
    const stream = streamOf('abc', 'def');
    await drainToString(stream, 4);

    const expected = true;
    const actual = stream.readableEnded;
    expect(actual).toBe(expected);
  });
});
