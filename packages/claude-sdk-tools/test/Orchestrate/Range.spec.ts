import { describe, expect, it } from 'vitest';
import { createRangeTool } from '../../src/Orchestrate/tools/Range.js';
import { ran as run } from './filters.js';

// The contract: the lines between the two bounds, counted from one and including both ends. Like
// Head, it stops reading once it is past the upper bound, and for the same reason: that is what
// makes a window over an expensive producer cost only as much as the window.

const ran = (input: Record<string, unknown>, chunks?: (string | Buffer)[]) => run(createRangeTool(), input, chunks);

describe('what comes out', () => {
  it('is the lines between the two bounds', async () => {
    const { output } = await ran({ start: 2, end: 4 }, ['a\nb\nc\nd\ne\n']);

    const expected = 'b\nc\nd\n';
    const actual = output;
    expect(actual).toBe(expected);
  });

  it('counts from one, so the first line is line one', async () => {
    const { output } = await ran({ start: 1, end: 1 }, ['a\nb\n']);

    const expected = 'a\n';
    const actual = output;
    expect(actual).toBe(expected);
  });

  it('includes the line at the upper bound', async () => {
    const { output } = await ran({ start: 1, end: 2 }, ['a\nb\nc\n']);

    const expected = 'a\nb\n';
    const actual = output;
    expect(actual).toBe(expected);
  });

  it('is everything from the lower bound on when the stream ends first', async () => {
    const { output } = await ran({ start: 2, end: 99 }, ['a\nb\nc\n']);

    const expected = 'b\nc\n';
    const actual = output;
    expect(actual).toBe(expected);
  });

  it('is nothing when the lower bound is past the end of the stream', async () => {
    const { output } = await ran({ start: 10, end: 20 }, ['a\nb\n']);

    const expected = '';
    const actual = output;
    expect(actual).toBe(expected);
  });

  it('is nothing when nothing was piped in', async () => {
    const { output } = await ran({ start: 1, end: 3 });

    const expected = '';
    const actual = output;
    expect(actual).toBe(expected);
  });

  it('is nothing when what was piped in was empty', async () => {
    const { output } = await ran({ start: 1, end: 3 }, ['']);

    const expected = '';
    const actual = output;
    expect(actual).toBe(expected);
  });
});

describe('a line split across two chunks', () => {
  it('is one line, not two', async () => {
    const { output } = await ran({ start: 2, end: 2 }, ['a\nb', '\nc\n']);

    const expected = 'b\n';
    const actual = output;
    expect(actual).toBe(expected);
  });

  it('is one character when a character was split down the middle', async () => {
    const { output } = await ran({ start: 1, end: 1 }, [Buffer.from([0xc3]), Buffer.from([0xa9, 0x0a])]);

    const expected = 'é\n';
    const actual = output;
    expect(actual).toBe(expected);
  });
});

describe('a last line with no newline on it', () => {
  it('is still a line, and still counted', async () => {
    const { output } = await ran({ start: 2, end: 3 }, ['a\nb\nc']);

    const expected = 'b\nc\n';
    const actual = output;
    expect(actual).toBe(expected);
  });
});

describe('how it reads', () => {
  it('stops reading once it is past the upper bound', async () => {
    const { taken, available } = await ran({ start: 1, end: 1 }, ['first\n', 'second\n', 'third\n']);

    const expected = true;
    const actual = taken < available;
    expect(actual).toBe(expected);
  });

  it('reads it all when the stream ended before the upper bound', async () => {
    const { taken, available } = await ran({ start: 1, end: 99 }, ['first\n', 'second\n']);

    const expected = true;
    const actual = taken === available;
    expect(actual).toBe(expected);
  });
});

describe('how it ends', () => {
  it('is finished, having done what it was asked', async () => {
    const { ended } = await ran({ start: 1, end: 2 }, ['a\nb\nc\n']);

    const expected = { kind: 'finished' };
    const actual = ended;
    expect(actual).toEqual(expected);
  });

  it('is finished when the window fell past the end of the stream', async () => {
    const { ended } = await ran({ start: 10, end: 20 }, ['a\n']);

    const expected = { kind: 'finished' };
    const actual = ended;
    expect(actual).toEqual(expected);
  });
});
