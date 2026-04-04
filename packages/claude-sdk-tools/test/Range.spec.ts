import { describe, expect, it } from 'vitest';
import { Range } from '../src/Range/Range';

describe('Range u2014 PipeFiles', () => {
  it('returns file paths at the given 1-based inclusive positions', async () => {
    const expected = ['b.ts', 'c.ts'];
    const result = (await Range.handler({ start: 2, end: 3, content: { type: 'files', values: ['a.ts', 'b.ts', 'c.ts', 'd.ts'] } }, new Map())) as { values: string[] };
    expect(result.values).toEqual(expected);
  });

  it('emits PipeFiles type', async () => {
    const expected = 'files';
    const result = (await Range.handler({ start: 1, end: 1, content: { type: 'files', values: ['a.ts'] } }, new Map())) as { type: string };
    expect(result.type).toEqual(expected);
  });

  it('clamps to the end of the list when end exceeds the length', async () => {
    const expected = ['b.ts', 'c.ts'];
    const result = (await Range.handler({ start: 2, end: 100, content: { type: 'files', values: ['a.ts', 'b.ts', 'c.ts'] } }, new Map())) as { values: string[] };
    expect(result.values).toEqual(expected);
  });
});

describe('Range u2014 PipeContent', () => {
  it('returns lines at the given 1-based inclusive positions', async () => {
    const expected = ['line2', 'line3'];
    const result = (await Range.handler({ start: 2, end: 3, content: { type: 'content', values: ['line1', 'line2', 'line3', 'line4'], totalLines: 4 } }, new Map())) as { values: string[] };
    expect(result.values).toEqual(expected);
  });

  it('emits PipeContent type', async () => {
    const expected = 'content';
    const result = (await Range.handler({ start: 1, end: 1, content: { type: 'content', values: ['a'], totalLines: 1 } }, new Map())) as { type: string };
    expect(result.type).toEqual(expected);
  });

  it('passes totalLines through unchanged', async () => {
    const expected = 100;
    const result = (await Range.handler({ start: 1, end: 2, content: { type: 'content', values: ['a', 'b', 'c'], totalLines: 100 } }, new Map())) as { totalLines: number };
    expect(result.totalLines).toEqual(expected);
  });

  it('passes path through unchanged', async () => {
    const expected = '/src/foo.ts';
    const result = (await Range.handler({ start: 1, end: 1, content: { type: 'content', values: ['x'], totalLines: 1, path: '/src/foo.ts' } }, new Map())) as { path?: string };
    expect(result.path).toEqual(expected);
  });

  it('returns empty content when content is null', async () => {
    const expected: string[] = [];
    const result = (await Range.handler({ start: 1, end: 10, content: undefined }, new Map())) as { values: string[] };
    expect(result.values).toEqual(expected);
  });
});
