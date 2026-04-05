import { describe, expect, it } from 'vitest';
import { Head } from '../src/Head/Head';
import { call } from './helpers';

describe('Head — PipeFiles', () => {
  it('returns the first N file paths', async () => {
    const result = (await call(Head, { count: 2, content: { type: 'files', values: ['a.ts', 'b.ts', 'c.ts'] } })) as { values: string[] };
    expect(result.values).toEqual(['a.ts', 'b.ts']);
  });

  it('returns all paths when count exceeds length', async () => {
    const result = (await call(Head, { count: 10, content: { type: 'files', values: ['a.ts'] } })) as { values: string[] };
    expect(result.values).toEqual(['a.ts']);
  });

  it('emits PipeFiles type', async () => {
    const result = (await call(Head, { count: 1, content: { type: 'files', values: ['a.ts'] } })) as { type: string };
    expect(result.type).toEqual('files');
  });
});

describe('Head — PipeContent', () => {
  it('returns the first N lines', async () => {
    const result = (await call(Head, { count: 2, content: { type: 'content', values: ['line1', 'line2', 'line3'], totalLines: 3 } })) as { values: string[] };
    expect(result.values).toEqual(['line1', 'line2']);
  });

  it('returns all lines when count exceeds length', async () => {
    const result = (await call(Head, { count: 10, content: { type: 'content', values: ['line1'], totalLines: 1 } })) as { values: string[] };
    expect(result.values).toEqual(['line1']);
  });

  it('passes totalLines through unchanged', async () => {
    const result = (await call(Head, { count: 5, content: { type: 'content', values: ['a', 'b', 'c'], totalLines: 100 } })) as { totalLines: number };
    expect(result.totalLines).toEqual(100);
  });

  it('passes path through unchanged', async () => {
    const result = (await call(Head, { count: 1, content: { type: 'content', values: ['x'], totalLines: 1, path: '/src/foo.ts' } })) as { path?: string };
    expect(result.path).toEqual('/src/foo.ts');
  });

  it('returns empty content when content is null', async () => {
    const result = (await call(Head, { count: 10, content: undefined })) as { values: string[] };
    expect(result.values).toEqual([]);
  });
});
