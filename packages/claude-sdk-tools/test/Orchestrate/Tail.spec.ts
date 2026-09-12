import { describe, expect, it } from 'vitest';
import { createTailTool } from '../../src/Orchestrate/tools/Tail.js';
import { ran as run } from './filters.js';

// The contract, and the whole of it: at most N lines out, and they are the last ones. Nothing about
// how it reads is promised here. It obviously has to reach the end before it can know which lines
// those are, but nobody relies on that, so it is not stated and not tested.

const ran = (input: Record<string, unknown>, chunks?: (string | Buffer)[]) => run(createTailTool(), input, chunks);

describe('what comes out', () => {
  it('is the last N lines', async () => {
    const { output } = await ran({ count: 2 }, ['a\nb\nc\nd\n']);

    const expected = 'c\nd\n';
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

  it('is in the order the lines arrived, not reversed', async () => {
    const { output } = await ran({ count: 3 }, ['one\ntwo\nthree\nfour\nfive\n']);

    const expected = 'three\nfour\nfive\n';
    const actual = output;
    expect(actual).toBe(expected);
  });

  // `tail` itself takes ten when you do not say.
  it('is the last ten when it was not told how many', async () => {
    const { output } = await ran({}, ['a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\n']);

    const expected = 'b\nc\nd\ne\nf\ng\nh\ni\nj\nk\n';
    const actual = output;
    expect(actual).toBe(expected);
  });
});

// Chunking is not input. Here it decides which lines are the last ones, so an implementation that
// treats a chunk as a line returns the wrong answer rather than a mangled one.
describe('a line split across two chunks', () => {
  it('is one line, not two', async () => {
    const { output } = await ran({ count: 2 }, ['a\nb', '\nc\n']);

    const expected = 'b\nc\n';
    const actual = output;
    expect(actual).toBe(expected);
  });

  it('is one character when a character was split down the middle', async () => {
    const { output } = await ran({ count: 1 }, [Buffer.from([0xc3]), Buffer.from([0xa9, 0x0a])]);

    const expected = 'é\n';
    const actual = output;
    expect(actual).toBe(expected);
  });
});

describe('a last line with no newline on it', () => {
  it('is still the last line', async () => {
    const { output } = await ran({ count: 2 }, ['a\nb\nc']);

    const expected = 'b\nc\n';
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
