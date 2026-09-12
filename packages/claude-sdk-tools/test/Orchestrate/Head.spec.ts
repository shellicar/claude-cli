import { describe, expect, it } from 'vitest';
import { createHeadTool } from '../../src/Orchestrate/tools/Head.js';
import { ran as run } from './filters.js';

// The contract: at most N lines out, and they are the first ones. The one thing beyond that is that
// it stops reading once it has them, which is not a shape but the promise a caller relies on when
// they write `Find | Head 3` and expect it not to walk the whole tree.

const ran = (input: Record<string, unknown>, chunks?: (string | Buffer)[]) => run(createHeadTool(), input, chunks);

describe('what comes out', () => {
  it('is the first N lines', async () => {
    const { output } = await ran({ count: 2 }, ['a\nb\nc\nd\n']);

    const expected = 'a\nb\n';
    const actual = output;
    expect(actual).toBe(expected);
  });

  it('is everything there was when there are fewer than N', async () => {
    const { output } = await ran({ count: 5 }, ['a\nb\n']);

    const expected = 'a\nb\n';
    const actual = output;
    expect(actual).toBe(expected);
  });

  it('is everything there was when there are exactly N', async () => {
    const { output } = await ran({ count: 2 }, ['a\nb\n']);

    const expected = 'a\nb\n';
    const actual = output;
    expect(actual).toBe(expected);
  });

  it('is nothing when nothing was piped in', async () => {
    const { output } = await ran({ count: 2 });

    const expected = '';
    const actual = output;
    expect(actual).toBe(expected);
  });

  it('is nothing when what was piped in was empty', async () => {
    const { output } = await ran({ count: 2 }, ['']);

    const expected = '';
    const actual = output;
    expect(actual).toBe(expected);
  });

  // `head` itself takes ten when you do not say.
  it('is the first ten when it was not told how many', async () => {
    const { output } = await ran({}, ['a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\n']);

    const expected = 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n';
    const actual = output;
    expect(actual).toBe(expected);
  });
});

// Chunking is not input. The same content arriving in different pieces is the same content, and an
// implementation that treats a chunk as a line is wrong in a way that looks right on small tests.
describe('a line split across two chunks', () => {
  it('is one line, not two', async () => {
    const { output } = await ran({ count: 2 }, ['a\nb', '\nc\n']);

    const expected = 'a\nb\n';
    const actual = output;
    expect(actual).toBe(expected);
  });

  it('is one line however many pieces it arrived in', async () => {
    const { output } = await ran({ count: 1 }, ['a', 'b', 'c', '\nsecond\n']);

    const expected = 'abc\n';
    const actual = output;
    expect(actual).toBe(expected);
  });

  // A character is not a byte. Split one down the middle and a reader that decodes each chunk on
  // its own turns it into two replacement characters, which is corruption that reads as text.
  it('is one character when a character was split down the middle', async () => {
    const { output } = await ran({ count: 1 }, [Buffer.from([0xc3]), Buffer.from([0xa9, 0x0a])]);

    const expected = 'é\n';
    const actual = output;
    expect(actual).toBe(expected);
  });
});

// Everything written here is newline-terminated, so nothing downstream has to handle two shapes. A
// stream whose last line lacked one came from outside: a file, or a process.
describe('a last line with no newline on it', () => {
  it('still counts as one of the N', async () => {
    const { output } = await ran({ count: 2 }, ['a\nb']);

    const expected = 'a\nb\n';
    const actual = output;
    expect(actual).toBe(expected);
  });

  it('is the only line when it is all there was', async () => {
    const { output } = await ran({ count: 2 }, ['only']);

    const expected = 'only\n';
    const actual = output;
    expect(actual).toBe(expected);
  });
});

describe('how it reads', () => {
  it('stops reading once it has what it asked for', async () => {
    const { taken, available } = await ran({ count: 1 }, ['first\n', 'second\n', 'third\n']);

    const expected = true;
    const actual = taken < available;
    expect(actual).toBe(expected);
  });

  it('reads it all when there was less than it asked for', async () => {
    const { taken, available } = await ran({ count: 10 }, ['first\n', 'second\n']);

    const expected = true;
    const actual = taken === available;
    expect(actual).toBe(expected);
  });
});

describe('how it ends', () => {
  it('is finished, having done what it was asked', async () => {
    const { ended } = await ran({ count: 2 }, ['a\nb\nc\n']);

    const expected = { kind: 'finished' };
    const actual = ended;
    expect(actual).toEqual(expected);
  });

  it('is finished when there was nothing to read', async () => {
    const { ended } = await ran({ count: 2 });

    const expected = { kind: 'finished' };
    const actual = ended;
    expect(actual).toEqual(expected);
  });
});
