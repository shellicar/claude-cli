import { describe, expect, it } from 'vitest';
import { splitArguments } from '../../src/Orchestrate/tools/Xargs.js';

// Bytes in, arguments out. One per line, because our producers emit a path per line and a path may
// contain spaces — `xargs -d '\n'`, always.

describe('splitting bytes into arguments', () => {
  it('takes one argument per line', () => {
    const expected = ['a.ts', 'b.ts'];
    const actual = splitArguments(Buffer.from('a.ts\nb.ts\n'));
    expect(actual).toEqual(expected);
  });

  it('does not split on a space', () => {
    const expected = ['my file.ts'];
    const actual = splitArguments(Buffer.from('my file.ts\n'));
    expect(actual).toEqual(expected);
  });

  it('treats a final separator as terminating the last argument, not starting another', () => {
    const expected = ['a.ts'];
    const actual = splitArguments(Buffer.from('a.ts\n'));
    expect(actual).toEqual(expected);
  });

  it('takes bytes with no separator at all as one argument', () => {
    const expected = ['a.ts'];
    const actual = splitArguments(Buffer.from('a.ts'));
    expect(actual).toEqual(expected);
  });

  it('drops an empty line rather than passing an empty argument', () => {
    const expected = ['a.ts', 'b.ts'];
    const actual = splitArguments(Buffer.from('a.ts\n\nb.ts\n'));
    expect(actual).toEqual(expected);
  });

  it('gives nothing for no bytes at all', () => {
    const expected: string[] = [];
    const actual = splitArguments(Buffer.from(''));
    expect(actual).toEqual(expected);
  });
});

// The bytes are split here and nowhere else, so being lenient cannot make two readers disagree
// about where an argument ended. What it avoids is a path arriving with a carriage return on it,
// which fails at the point of use with a message that never mentions it.
describe('splitting bytes that came from a producer using CRLF', () => {
  it('leaves no carriage return on an argument', () => {
    const expected = ['a.ts', 'b.ts'];
    const actual = splitArguments(Buffer.from('a.ts\r\nb.ts\r\n'));
    expect(actual).toEqual(expected);
  });

  it('strips only the one at the end', () => {
    const expected = ['we\rird.ts'];
    const actual = splitArguments(Buffer.from('we\rird.ts\r\n'));
    expect(actual).toEqual(expected);
  });

  it('keeps a trailing space, which a filename may really have', () => {
    const expected = ['spacey.ts '];
    const actual = splitArguments(Buffer.from('spacey.ts \n'));
    expect(actual).toEqual(expected);
  });
});

describe('splitting bytes that are not text', () => {
  it('keeps every byte of an argument as it arrived', () => {
    const expected = 'caf\u00e9.ts';
    const actual = splitArguments(Buffer.from('café.ts\n', 'utf8'))[0];
    expect(actual).toBe(expected);
  });
});
