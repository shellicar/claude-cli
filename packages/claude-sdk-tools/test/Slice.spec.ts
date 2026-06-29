import { describe, expect, it } from 'vitest';
import { Slice } from '../src/Slice/Slice';
import type { ContentStream, FilesStream } from '../src/stream';

const files = (...names: string[]): FilesStream => ({ kind: 'files', files: names.map((path) => ({ path, type: 'file' })) });

describe('Slice — files grain', () => {
  it('takes a 0-based half-open window', async () => {
    const expected = ['b', 'c'];
    const actual = (await Slice.run({ start: 1, end: 3, input: files('a', 'b', 'c', 'd') })).files.map((f) => f.path);
    expect(actual).toEqual(expected);
  });

  it('counts a negative start from the end', async () => {
    const expected = ['c', 'd'];
    const actual = (await Slice.run({ start: -2, end: undefined, input: files('a', 'b', 'c', 'd') })).files.map((f) => f.path);
    expect(actual).toEqual(expected);
  });
});

describe('Slice — content grain', () => {
  it('windows lines per file', async () => {
    const expected = [{ n: 2, text: 'b' }];
    const actual = (
      (await Slice.run({
        start: 1,
        end: 2,
        input: { kind: 'content', files: [{ path: '/a', type: 'file', lines: [{ n: 1, text: 'a' }, { n: 2, text: 'b' }, { n: 3, text: 'c' }] }] },
      })) as ContentStream
    ).files[0].lines;
    expect(actual).toEqual(expected);
  });
});
