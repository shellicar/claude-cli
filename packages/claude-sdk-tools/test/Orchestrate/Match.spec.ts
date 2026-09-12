import { describe, expect, it } from 'vitest';
import { createMatchTool } from '../../src/Orchestrate/tools/Match.js';
import { ran as run } from './filters.js';

// The contract: the lines that match, in the order they arrived, all of them. It reaches the end of
// the stream because the last line may be the one that matches, but nobody relies on that, so it is
// a consequence rather than a promise and is not stated here.

const ran = (input: Record<string, unknown>, chunks?: (string | Buffer)[]) => run(createMatchTool(), input, chunks);

describe('what comes out', () => {
  it('is the lines that match', async () => {
    const { output } = await ran({ pattern: 'b' }, ['alpha\nbravo\ncharlie\n']);

    const expected = 'bravo\n';
    const actual = output;
    expect(actual).toBe(expected);
  });

  it('is every line that matches, not only the first', async () => {
    const { output } = await ran({ pattern: 'a' }, ['alpha\nbravo\necho\n']);

    const expected = 'alpha\nbravo\n';
    const actual = output;
    expect(actual).toBe(expected);
  });

  it('is in the order the lines arrived', async () => {
    const { output } = await ran({ pattern: '\\d' }, ['one1\ntwo\nthree3\nfour4\n']);

    const expected = 'one1\nthree3\nfour4\n';
    const actual = output;
    expect(actual).toBe(expected);
  });

  it('is nothing when none of them match', async () => {
    const { output } = await ran({ pattern: 'zulu' }, ['alpha\nbravo\n']);

    const expected = '';
    const actual = output;
    expect(actual).toBe(expected);
  });

  it('is nothing when nothing was piped in', async () => {
    const { output } = await ran({ pattern: 'a' });

    const expected = '';
    const actual = output;
    expect(actual).toBe(expected);
  });

  it('is nothing when what was piped in was empty', async () => {
    const { output } = await ran({ pattern: 'a' }, ['']);

    const expected = '';
    const actual = output;
    expect(actual).toBe(expected);
  });
});

describe('how it matches', () => {
  it('minds the case of the pattern', async () => {
    const { output } = await ran({ pattern: 'ALPHA' }, ['alpha\n']);

    const expected = '';
    const actual = output;
    expect(actual).toBe(expected);
  });

  it('ignores the case when it was told to', async () => {
    const { output } = await ran({ pattern: 'ALPHA', caseInsensitive: true }, ['alpha\n']);

    const expected = 'alpha\n';
    const actual = output;
    expect(actual).toBe(expected);
  });

  it('tests the line without its terminator, so an anchored pattern matches', async () => {
    const { output } = await ran({ pattern: 'alpha$' }, ['alpha\nbravo\n']);

    const expected = 'alpha\n';
    const actual = output;
    expect(actual).toBe(expected);
  });
});

describe('lines around a match', () => {
  it('includes the ones before it when asked', async () => {
    const { output } = await ran({ pattern: 'c', before: 1 }, ['a\nb\nc\nd\n']);

    const expected = 'b\nc\n';
    const actual = output;
    expect(actual).toBe(expected);
  });

  it('includes the ones after it when asked', async () => {
    const { output } = await ran({ pattern: 'b', after: 1 }, ['a\nb\nc\nd\n']);

    const expected = 'b\nc\n';
    const actual = output;
    expect(actual).toBe(expected);
  });

  it('includes what there was when the match is nearer the start than that', async () => {
    const { output } = await ran({ pattern: 'a', before: 3 }, ['a\nb\n']);

    const expected = 'a\n';
    const actual = output;
    expect(actual).toBe(expected);
  });

  // Two matches close together share the lines between them. Each line comes out once, in place,
  // rather than once per match that claimed it.
  it('writes a line once when two matches both reach it', async () => {
    const { output } = await ran({ pattern: '[ac]', before: 1, after: 1 }, ['a\nb\nc\nd\n']);

    const expected = 'a\nb\nc\nd\n';
    const actual = output;
    expect(actual).toBe(expected);
  });
});

describe('a line split across two chunks', () => {
  it('is matched as one line, not as the pieces it arrived in', async () => {
    const { output } = await ran({ pattern: '^alpha$' }, ['al', 'pha\nbravo\n']);

    const expected = 'alpha\n';
    const actual = output;
    expect(actual).toBe(expected);
  });

  it('is one character when a character was split down the middle', async () => {
    const { output } = await ran({ pattern: 'é' }, [Buffer.from([0xc3]), Buffer.from([0xa9, 0x0a])]);

    const expected = 'é\n';
    const actual = output;
    expect(actual).toBe(expected);
  });
});

describe('a last line with no newline on it', () => {
  it('is still tested, and still written when it matches', async () => {
    const { output } = await ran({ pattern: 'bravo' }, ['alpha\nbravo']);

    const expected = 'bravo\n';
    const actual = output;
    expect(actual).toBe(expected);
  });
});

describe('what it says', () => {
  // The lines it wrote are the count. Saying "3 matched" next to three lines is a number nobody
  // needed, and silence is what tells me the answer is whole.
  it('says nothing at all', async () => {
    const { said } = await ran({ pattern: 'a' }, ['alpha\nbravo\n']);

    const expected: string[] = [];
    const actual = said;
    expect(actual).toEqual(expected);
  });
});

describe('how it ends', () => {
  it('is finished when lines matched', async () => {
    const { ended } = await ran({ pattern: 'a' }, ['alpha\n']);

    const expected = { kind: 'finished' };
    const actual = ended;
    expect(actual).toEqual(expected);
  });

  // Finding nothing is an answer, not a failure. `grep` exits 1 here and that is a shell idiom for
  // gating, not a claim that anything went wrong; a stage reported as failed would send whoever
  // reads the report looking for a defect.
  it('is finished when nothing matched', async () => {
    const { ended } = await ran({ pattern: 'zulu' }, ['alpha\n']);

    const expected = { kind: 'finished' };
    const actual = ended;
    expect(actual).toEqual(expected);
  });
});
