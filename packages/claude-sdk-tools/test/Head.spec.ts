import { describe, expect, it } from 'vitest';
import { Head } from '../src/Head/Head';

describe('Head — PipeFiles', () => {
  it('returns the first N file paths', async () => {
    const expected = ['a.ts', 'b.ts'];
    const result = (await Head.handler({ count: 2, content: { type: 'files', values: ['a.ts', 'b.ts', 'c.ts'] } }, new Map())) as { values: string[] };
    expect(result.values).toEqual(expected);
  });

  it('returns all paths when count exceeds length', async () => {
    const expected = ['a.ts'];
    const result = (await Head.handler({ count: 10, content: { type: 'files', values: ['a.ts'] } }, new Map())) as { values: string[] };
    expect(result.values).toEqual(expected);
  });

  it('emits PipeFiles type', async () => {
    const expected = 'files';
    const result = (await Head.handler({ count: 1, content: { type: 'files', values: ['a.ts'] } }, new Map())) as { type: string };
    expect(result.type).toEqual(expected);
  });
});

describe('Head — PipeContent', () => {
  it('returns the first N lines', async () => {
    const expected = ['line1', 'line2'];
    const result = (await Head.handler({ count: 2, content: { type: 'content', values: ['line1', 'line2', 'line3'], totalLines: 3 } }, new Map())) as { values: string[] };
    expect(result.values).toEqual(expected);
  });

  it('returns all lines when count exceeds length', async () => {
    const expected = ['line1'];
    const result = (await Head.handler({ count: 10, content: { type: 'content', values: ['line1'], totalLines: 1 } }, new Map())) as { values: string[] };
    expect(result.values).toEqual(expected);
  });

  it('passes totalLines through unchanged', async () => {
    const expected = 100;
    const result = (await Head.handler({ count: 5, content: { type: 'content', values: ['a', 'b', 'c'], totalLines: 100 } }, new Map())) as { totalLines: number };
    expect(result.totalLines).toEqual(expected);
  });

  it('passes path through unchanged', async () => {
    const expected = '/src/foo.ts';
    const result = (await Head.handler({ count: 1, content: { type: 'content', values: ['x'], totalLines: 1, path: '/src/foo.ts' } }, new Map())) as { path?: string };
    expect(result.path).toEqual(expected);
  });

  it('returns empty content when content is null', async () => {
    const expected: string[] = [];
    const result = (await Head.handler({ count: 10, content: undefined }, new Map())) as { values: string[] };
    expect(result.values).toEqual(expected);
  });
});
