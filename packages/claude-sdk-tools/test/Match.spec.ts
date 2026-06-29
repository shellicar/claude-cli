import { describe, expect, it } from 'vitest';
import { Match } from '../src/Match/Match';
import type { ContentStream } from '../src/stream';

describe('Match — files grain', () => {
  it('keeps only files whose path matches', async () => {
    const expected = ['/a.test.ts'];
    const actual = (
      await Match.run({
        pattern: '\\.test\\.ts$',
        caseInsensitive: false,
        before: 0,
        after: 0,
        input: { kind: 'files', files: [{ path: '/a.test.ts', type: 'file' }, { path: '/a.ts', type: 'file' }] },
      })
    ).files.map((f) => f.path);
    expect(actual).toEqual(expected);
  });
});

describe('Match — content grain', () => {
  it('keeps only matching lines within a file', async () => {
    const expected = ['export const a'];
    const actual = (
      (await Match.run({
        pattern: 'export',
        caseInsensitive: false,
        before: 0,
        after: 0,
        input: { kind: 'content', files: [{ path: '/a.ts', type: 'file', lines: [{ n: 1, text: 'export const a' }, { n: 2, text: 'const b' }] }] },
      })) as ContentStream
    ).files[0].lines.map((l) => l.text);
    expect(actual).toEqual(expected);
  });

  it('drops a file with no matching lines', async () => {
    const expected = 0;
    const actual = (
      await Match.run({
        pattern: 'NOPE',
        caseInsensitive: false,
        before: 0,
        after: 0,
        input: { kind: 'content', files: [{ path: '/a.ts', type: 'file', lines: [{ n: 1, text: 'a' }] }] },
      })
    ).files.length;
    expect(actual).toBe(expected);
  });

  it('includes `before` context lines above a match', async () => {
    const expected = [2, 3];
    const actual = (
      (await Match.run({
        pattern: 'match',
        caseInsensitive: false,
        before: 1,
        after: 0,
        input: { kind: 'content', files: [{ path: '/a.ts', type: 'file', lines: [{ n: 1, text: 'a' }, { n: 2, text: 'b' }, { n: 3, text: 'match' }] }] },
      })) as ContentStream
    ).files[0].lines.map((l) => l.n);
    expect(actual).toEqual(expected);
  });

  it('includes `after` context lines below a match', async () => {
    const expected = [2, 3];
    const actual = (
      (await Match.run({
        pattern: 'match',
        caseInsensitive: false,
        before: 0,
        after: 1,
        input: { kind: 'content', files: [{ path: '/a.ts', type: 'file', lines: [{ n: 1, text: 'a' }, { n: 2, text: 'match' }, { n: 3, text: 'b' }] }] },
      })) as ContentStream
    ).files[0].lines.map((l) => l.n);
    expect(actual).toEqual(expected);
  });
});
