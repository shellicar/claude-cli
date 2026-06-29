import { describe, expect, it } from 'vitest';
import { Range } from '../src/Range/Range';
import type { ContentStream, FilesStream } from '../src/stream';

const files = (...names: string[]): FilesStream => ({ kind: 'files', files: names.map((path) => ({ path, type: 'file' })) });
const content = (...texts: string[]): ContentStream => ({ kind: 'content', files: [{ path: '/a', type: 'file', lines: texts.map((text, i) => ({ n: i + 1, text })) }] });

describe('Range — files grain', () => {
  it('takes files at the 1-based inclusive positions', async () => {
    const expected = ['b', 'c'];
    const actual = (await Range.run({ start: 2, end: 3, input: files('a', 'b', 'c', 'd') })).files.map((f) => f.path);
    expect(actual).toEqual(expected);
  });

  it('clamps to the end when end exceeds the length', async () => {
    const expected = ['b', 'c'];
    const actual = (await Range.run({ start: 2, end: 100, input: files('a', 'b', 'c') })).files.map((f) => f.path);
    expect(actual).toEqual(expected);
  });
});

describe('Range — content grain', () => {
  it('takes lines at the 1-based inclusive positions', async () => {
    const expected = ['b', 'c'];
    const actual = ((await Range.run({ start: 2, end: 3, input: content('a', 'b', 'c', 'd') })) as ContentStream).files[0].lines.map((l) => l.text);
    expect(actual).toEqual(expected);
  });
});
