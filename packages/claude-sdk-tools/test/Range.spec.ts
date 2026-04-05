import { describe, expect, it } from 'vitest';
import { Range } from '../src/Range/Range';
import { call } from './helpers';

describe('Range u2014 PipeFiles', () => {
  it('returns file paths at the given 1-based inclusive positions', async () => {
    const result = (await call(Range, { start: 2, end: 3, content: { type: 'files', values: ['a.ts', 'b.ts', 'c.ts', 'd.ts'] } })) as { values: string[] };
    expect(result.values).toEqual(['b.ts', 'c.ts']);
  });

  it('emits PipeFiles type', async () => {
    const result = (await call(Range, { start: 1, end: 1, content: { type: 'files', values: ['a.ts'] } })) as { type: string };
    expect(result.type).toEqual('files');
  });

  it('clamps to the end of the list when end exceeds the length', async () => {
    const result = (await call(Range, { start: 2, end: 100, content: { type: 'files', values: ['a.ts', 'b.ts', 'c.ts'] } })) as { values: string[] };
    expect(result.values).toEqual(['b.ts', 'c.ts']);
  });
});

describe('Range u2014 PipeContent', () => {
  it('returns lines at the given 1-based inclusive positions', async () => {
    const result = (await call(Range, { start: 2, end: 3, content: { type: 'content', values: ['line1', 'line2', 'line3', 'line4'], totalLines: 4 } })) as { values: string[] };
    expect(result.values).toEqual(['line2', 'line3']);
  });

  it('emits PipeContent type', async () => {
    const result = (await call(Range, { start: 1, end: 1, content: { type: 'content', values: ['a'], totalLines: 1 } })) as { type: string };
    expect(result.type).toEqual('content');
  });

  it('passes totalLines through unchanged', async () => {
    const result = (await call(Range, { start: 1, end: 2, content: { type: 'content', values: ['a', 'b', 'c'], totalLines: 100 } })) as { totalLines: number };
    expect(result.totalLines).toEqual(100);
  });

  it('passes path through unchanged', async () => {
    const result = (await call(Range, { start: 1, end: 1, content: { type: 'content', values: ['x'], totalLines: 1, path: '/src/foo.ts' } })) as { path?: string };
    expect(result.path).toEqual('/src/foo.ts');
  });

  it('returns empty content when content is null', async () => {
    const result = (await call(Range, { start: 1, end: 10, content: undefined })) as { values: string[] };
    expect(result.values).toEqual([]);
  });
});
