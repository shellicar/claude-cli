import { describe, expect, it } from 'vitest';
import { Grep } from '../src/Grep/Grep';
import { call } from './helpers';

describe('Grep u2014 PipeFiles', () => {
  it('filters file paths matching the pattern', async () => {
    const result = (await call(Grep, { pattern: '.ts$', content: { type: 'files', values: ['src/foo.ts', 'src/bar.ts', 'src/readme.md'] } })) as { type: 'files'; values: string[] };
    expect(result.values).toEqual(['src/foo.ts', 'src/bar.ts']);
  });

  it('returns empty values when no paths match', async () => {
    const result = (await call(Grep, { pattern: '.ts$', content: { type: 'files', values: ['src/readme.md'] } })) as { type: 'files'; values: string[] };
    expect(result.values).toEqual([]);
  });

  it('emits PipeFiles type', async () => {
    const result = (await call(Grep, { pattern: 'foo', content: { type: 'files', values: ['foo.ts'] } })) as { type: string };
    expect(result.type).toEqual('files');
  });

  it('matches case insensitively when flag is set', async () => {
    const result = (await call(Grep, { pattern: '.ts$', caseInsensitive: true, content: { type: 'files', values: ['SRC/FOO.TS', 'SRC/README.MD'] } })) as { type: 'files'; values: string[] };
    expect(result.values).toEqual(['SRC/FOO.TS']);
  });
});

describe('Grep u2014 PipeContent', () => {
  it('filters lines matching the pattern', async () => {
    const result = (await call(Grep, { pattern: '^export', content: { type: 'content', values: ['export const x = 1;', 'const y = 2;'], totalLines: 2 } })) as { type: 'content'; values: string[] };
    expect(result.values).toEqual(['export const x = 1;']);
  });

  it('emits PipeContent type', async () => {
    const result = (await call(Grep, { pattern: 'foo', content: { type: 'content', values: ['foo'], totalLines: 1 } })) as { type: string };
    expect(result.type).toEqual('content');
  });

  it('passes totalLines through unchanged', async () => {
    const result = (await call(Grep, { pattern: 'foo', content: { type: 'content', values: ['foo', 'bar'], totalLines: 10 } })) as { totalLines: number };
    expect(result.totalLines).toEqual(10);
  });

  it('passes path through unchanged', async () => {
    const result = (await call(Grep, { pattern: 'foo', content: { type: 'content', values: ['foo'], totalLines: 1, path: '/src/foo.ts' } })) as { path?: string };
    expect(result.path).toEqual('/src/foo.ts');
  });

  it('includes context lines around a match', async () => {
    const result = (await call(Grep, { pattern: 'match', context: 1, content: { type: 'content', values: ['before', 'match', 'after'], totalLines: 3 } })) as { values: string[] };
    expect(result.values).toEqual(['before', 'match', 'after']);
  });

  it('does not include lines outside the context window', async () => {
    const result = (await call(Grep, { pattern: 'match', context: 1, content: { type: 'content', values: ['a', 'b', 'match', 'c', 'd'], totalLines: 5 } })) as { values: string[] };
    expect(result.values).toEqual(['b', 'match', 'c']);
  });

  it('returns empty values when no lines match', async () => {
    const result = (await call(Grep, { pattern: 'xyz', content: { type: 'content', values: ['foo', 'bar'], totalLines: 2 } })) as { values: string[] };
    expect(result.values).toEqual([]);
  });

  it('returns empty content when content is null', async () => {
    const result = (await call(Grep, { pattern: 'foo', content: undefined })) as { values: string[] };
    expect(result.values).toEqual([]);
  });

  it('emits 1-based lineNumbers for matched lines', async () => {
    const result = (await call(Grep, { pattern: 'match', content: { type: 'content', values: ['a', 'match', 'b', 'match'], totalLines: 4 } })) as { lineNumbers: number[] };
    expect(result.lineNumbers).toEqual([2, 4]);
  });

  it('lineNumbers include context lines with correct original positions', async () => {
    const result = (await call(Grep, { pattern: 'match', context: 1, content: { type: 'content', values: ['a', 'b', 'match', 'c', 'd'], totalLines: 5 } })) as { lineNumbers: number[] };
    expect(result.lineNumbers).toEqual([2, 3, 4]);
  });

  it('lineNumbers thread through when input already has lineNumbers (chained Grep)', async () => {
    // First grep: lines 2 and 4 of 6 match 'keep'
    const first = (await call(Grep, { pattern: 'keep', content: { type: 'content', values: ['a', 'keep', 'b', 'keep', 'c', 'd'], totalLines: 6 } })) as { type: 'content'; values: string[]; lineNumbers: number[] };
    expect(first.lineNumbers).toEqual([2, 4]);
    // Second grep on first result: only line 4 ('keep2') matches
    const second = (await call(Grep, { pattern: 'keep2', content: { ...first, totalLines: first.values.length, values: ['keep1', 'keep2'] } })) as { lineNumbers: number[] };
    expect(second.lineNumbers).toEqual([4]);
  });
});
