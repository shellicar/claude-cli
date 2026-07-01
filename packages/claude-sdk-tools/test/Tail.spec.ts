import { describe, expect, it } from 'vitest';
import type { ContentStream, FilesStream } from '../src/stream';
import { Tail } from '../src/Tail/Tail';

const files = (...names: string[]): FilesStream => ({ kind: 'files', files: names.map((path) => ({ path, type: 'file' })) });
const content = (...texts: string[]): ContentStream => ({ kind: 'content', files: [{ path: '/a', type: 'file', lines: texts.map((text, i) => ({ n: i + 1, text })) }] });

describe('Tail — files grain', () => {
  it('takes the last N files', async () => {
    const expected = ['b', 'c'];
    const actual = (await Tail.run({ count: 2, input: files('a', 'b', 'c') })).files.map((f) => f.path);
    expect(actual).toEqual(expected);
  });
});

describe('Tail — content grain', () => {
  it('takes the last N lines per file', async () => {
    const expected = ['b'];
    const actual = ((await Tail.run({ count: 1, input: content('a', 'b') })) as ContentStream).files[0].lines.map((l) => l.text);
    expect(actual).toEqual(expected);
  });
});
