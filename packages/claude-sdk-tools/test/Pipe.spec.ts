import { describe, expect, it } from 'vitest';
import { createFind } from '../src/Find/Find';
import { Match } from '../src/Match/Match';
import { createPaths } from '../src/Paths/Paths';
import { createPipe } from '../src/Pipe/Pipe';
import { createRead } from '../src/Read/Read';
import { MemoryFileSystem } from './MemoryFileSystem';
import { call } from './helpers';

const build = (fs = new MemoryFileSystem()) => createPipe([createFind(fs), createPaths(fs), createRead(fs), Match]);

describe('Pipe — composition validity (pre-flight)', () => {
  it('rejects a stage as the first step', async () => {
    const expected = 'is not a source';
    const actual = (await call(build(), { steps: [{ tool: 'Read', input: {} }] })) as { error: string };
    expect(actual.error).toContain(expected);
  });

  it('rejects an unknown tool', async () => {
    const expected = 'Unknown tool';
    const actual = (await call(build(), { steps: [{ tool: 'Nope', input: {} }] })) as { error: string };
    expect(actual.error).toContain(expected);
  });

  it('rejects a step whose input kind does not match the previous output', async () => {
    const fs = new MemoryFileSystem({ '/a.ts': 'x' });
    const expected = 2; // Read emits content; a second Read wants files → mismatch at index 2
    const actual = (await call(build(fs), {
      steps: [{ tool: 'Paths', input: { paths: ['/a.ts'] } }, { tool: 'Read', input: {} }, { tool: 'Read', input: {} }],
    })) as { step: number };
    expect(actual.step).toBe(expected);
  });
});

describe('Pipe — run-time fatal (does not throw, maps to the fatal object)', () => {
  const fs = new MemoryFileSystem();
  const steps = [{ tool: 'Paths', input: { paths: ['/nope'] } }, { tool: 'Read', input: {} }];

  it('returns the fatal object naming the failing tool', async () => {
    const expected = 'Paths';
    const actual = (await call(build(fs), { steps })) as { tool: string };
    expect(actual.tool).toBe(expected); // resolved, not rejected
  });

  it('reports the failing step index', async () => {
    const expected = 0;
    const actual = (await call(build(fs), { steps })) as { step: number };
    expect(actual.step).toBe(expected);
  });

  it('carries the offending input', async () => {
    const expected = { paths: ['/nope'] };
    const actual = (await call(build(fs), { steps })) as { input: unknown };
    expect(actual.input).toEqual(expected);
  });
});

describe('Pipe — terminus flatten', () => {
  it('flattens a Paths | Read content stream grouped by file', async () => {
    const fs = new MemoryFileSystem({ '/a.ts': 'export const a\nconst b' });
    const expected = '/a.ts\n1:export const a\n2:const b';
    const actual = await call(build(fs), { steps: [{ tool: 'Paths', input: { paths: ['/a.ts'] } }, { tool: 'Read', input: {} }] });
    expect(actual).toBe(expected);
  });

  it('flattens a Find | Match files stream filtered by path', async () => {
    const fs = new MemoryFileSystem({ '/src/a.test.ts': 'x', '/src/a.ts': 'y' });
    const expected = '/src/a.test.ts';
    const actual = await call(build(fs), { steps: [{ tool: 'Find', input: { path: '/src' } }, { tool: 'Match', input: { pattern: '\\.test\\.ts$' } }] });
    expect(actual).toContain(expected);
  });
});
