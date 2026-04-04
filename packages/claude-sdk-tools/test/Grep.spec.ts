import { describe, expect, it } from 'vitest';
import { Grep } from '../src/Grep/Grep';

describe('Grep — PipeFiles', () => {
  it('filters file paths matching the pattern', async () => {
    const expected = ['src/foo.ts', 'src/bar.ts'];
    const actual = await Grep.handler({ pattern: '\.ts$', caseInsensitive: false, context: 0, content: { type: 'files', values: ['src/foo.ts', 'src/bar.ts', 'src/readme.md'] } }, new Map());
    expect(actual).toEqual(expected);
  });

  it('returns empty values when no paths match', async () => {
    const expected: string[] = [];
    const result = await Grep.handler({ pattern: '\.ts$', caseInsensitive: false, context: 0, content: { type: 'files', values: ['src/readme.md'] } }, new Map()) as { type: 'files'; values: string[] };
    expect(result.values).toEqual(expected);
  });

  it('emits PipeFiles type', async () => {
    const expected = 'files';
    const result = await Grep.handler({ pattern: 'foo', caseInsensitive: false, context: 0, content: { type: 'files', values: ['foo.ts'] } }, new Map()) as { type: string };
    expect(result.type).toEqual(expected);
  });

  it('matches case insensitively when flag is set', async () => {
    const expected = ['SRC/FOO.TS'];
    const result = await Grep.handler({ pattern: '\.ts$', caseInsensitive: true, context: 0, content: { type: 'files', values: ['SRC/FOO.TS', 'SRC/README.MD'] } }, new Map()) as { type: 'files'; values: string[] };
    expect(result.values).toEqual(expected);
  });
});

describe('Grep — PipeContent', () => {
  it('filters lines matching the pattern', async () => {
    const expected = ['export const x = 1;'];
    const result = await Grep.handler({ pattern: '^export', caseInsensitive: false, context: 0, content: { type: 'content', values: ['export const x = 1;', 'const y = 2;'], totalLines: 2 } }, new Map()) as { type: 'content'; values: string[] };
    expect(result.values).toEqual(expected);
  });

  it('emits PipeContent type', async () => {
    const expected = 'content';
    const result = await Grep.handler({ pattern: 'foo', caseInsensitive: false, context: 0, content: { type: 'content', values: ['foo'], totalLines: 1 } }, new Map()) as { type: string };
    expect(result.type).toEqual(expected);
  });

  it('passes totalLines through unchanged', async () => {
    const expected = 10;
    const result = await Grep.handler({ pattern: 'foo', caseInsensitive: false, context: 0, content: { type: 'content', values: ['foo', 'bar'], totalLines: 10 } }, new Map()) as { totalLines: number };
    expect(result.totalLines).toEqual(expected);
  });

  it('passes path through unchanged', async () => {
    const expected = '/src/foo.ts';
    const result = await Grep.handler({ pattern: 'foo', caseInsensitive: false, context: 0, content: { type: 'content', values: ['foo'], totalLines: 1, path: '/src/foo.ts' } }, new Map()) as { path?: string };
    expect(result.path).toEqual(expected);
  });

  it('includes context lines around a match', async () => {
    const expected = ['before', 'match', 'after'];
    const result = await Grep.handler({ pattern: 'match', caseInsensitive: false, context: 1, content: { type: 'content', values: ['before', 'match', 'after'], totalLines: 3 } }, new Map()) as { values: string[] };
    expect(result.values).toEqual(expected);
  });

  it('does not include lines outside the context window', async () => {
    const expected = ['b', 'match', 'c'];
    const result = await Grep.handler({ pattern: 'match', caseInsensitive: false, context: 1, content: { type: 'content', values: ['a', 'b', 'match', 'c', 'd'], totalLines: 5 } }, new Map()) as { values: string[] };
    expect(result.values).toEqual(expected);
  });

  it('returns empty values when no lines match', async () => {
    const expected: string[] = [];
    const result = await Grep.handler({ pattern: 'xyz', caseInsensitive: false, context: 0, content: { type: 'content', values: ['foo', 'bar'], totalLines: 2 } }, new Map()) as { values: string[] };
    expect(result.values).toEqual(expected);
  });

  it('returns empty content when content is null', async () => {
    const expected: string[] = [];
    const result = await Grep.handler({ pattern: 'foo', caseInsensitive: false, context: 0, content: undefined }, new Map()) as { values: string[] };
    expect(result.values).toEqual(expected);
  });
});
