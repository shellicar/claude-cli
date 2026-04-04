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
});
