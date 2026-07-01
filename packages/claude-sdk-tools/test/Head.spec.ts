import { describe, expect, it } from 'vitest';
import { Head } from '../src/Head/Head';
import type { ContentStream, FilesStream } from '../src/stream';

const files = (...names: string[]): FilesStream => ({ kind: 'files', files: names.map((path) => ({ path, type: 'file' })) });
const content = (...texts: string[]): ContentStream => ({ kind: 'content', files: [{ path: '/a', type: 'file', lines: texts.map((text, i) => ({ n: i + 1, text })) }] });

describe('Head — files grain', () => {
  it('takes the first N files', async () => {
    const expected = ['a', 'b'];
    const actual = (await Head.run({ count: 2, input: files('a', 'b', 'c') })).files.map((f) => f.path);
    expect(actual).toEqual(expected);
  });
});

describe('Head — content grain', () => {
  it('takes the first N lines per file', async () => {
    const expected = ['a'];
    const actual = ((await Head.run({ count: 1, input: content('a', 'b') })) as ContentStream).files[0].lines.map((l) => l.text);
    expect(actual).toEqual(expected);
  });
});
