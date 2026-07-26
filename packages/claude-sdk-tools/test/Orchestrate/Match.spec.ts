import type { Stream } from '@shellicar/orchestrate-core';
import { describe, expect, it } from 'vitest';
import { createMatchToolV2 } from '../../src/Orchestrate/tools/Match.js';

async function* streamOf(values: string[]): Stream<string> {
  for (const v of values) {
    yield v;
  }
}

async function drain(stream: Stream<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const value of stream) {
    out.push(value);
  }
  return out;
}

describe('Match tool — uniform matching, no kind branch', () => {
  it('matches against paths exactly the same way it matches against content, unaware of provenance', async () => {
    const tool = createMatchToolV2();
    const { stdout } = tool.run({ pattern: 'TODO' }, streamOf(['src/TODO.txt', 'src/other.txt']), []);

    const expected = ['src/TODO.txt'];
    const actual = await drain(stdout);
    expect(actual).toEqual(expected);
  });

  it('is case insensitive when asked', async () => {
    const tool = createMatchToolV2();
    const { stdout } = tool.run({ pattern: 'todo', caseInsensitive: true }, streamOf(['TODO', 'nope']), []);

    const expected = ['TODO'];
    const actual = await drain(stdout);
    expect(actual).toEqual(expected);
  });

  it('yields nothing when there is no upstream at all', async () => {
    const tool = createMatchToolV2();
    const { stdout } = tool.run({ pattern: 'x' }, undefined, []);

    const expected: string[] = [];
    const actual = await drain(stdout);
    expect(actual).toEqual(expected);
  });
});

describe('Match tool — before/after context', () => {
  it('includes the requested number of lines before a match', async () => {
    const tool = createMatchToolV2();
    const { stdout } = tool.run({ pattern: 'MATCH', before: 1 }, streamOf(['a', 'b', 'MATCH', 'c']), []);

    const expected = ['b', 'MATCH'];
    const actual = await drain(stdout);
    expect(actual).toEqual(expected);
  });

  it('includes the requested number of lines after a match', async () => {
    const tool = createMatchToolV2();
    const { stdout } = tool.run({ pattern: 'MATCH', after: 1 }, streamOf(['a', 'MATCH', 'b', 'c']), []);

    const expected = ['MATCH', 'b'];
    const actual = await drain(stdout);
    expect(actual).toEqual(expected);
  });

  it('does not duplicate a line shared by two overlapping match windows', async () => {
    const tool = createMatchToolV2();
    // MATCH at index 1 (after=2 covers indices 1-3), MATCH at index 3 (before=2 covers 1-3) — index
    // 2 and 3 are shared by both windows; each line must still appear exactly once, in order.
    const { stdout } = tool.run({ pattern: 'MATCH', before: 2, after: 2 }, streamOf(['x', 'MATCH', 'y', 'MATCH', 'z']), []);

    const expected = ['x', 'MATCH', 'y', 'MATCH', 'z'];
    const actual = await drain(stdout);
    expect(actual).toEqual(expected);
  });
});

describe('Match tool — laziness', () => {
  it('does not pull the whole upstream when the caller stops early', async () => {
    const pulled: string[] = [];
    async function* infinite(): Stream<string> {
      let i = 0;
      try {
        while (true) {
          pulled.push(`line${i}`);
          yield `line${i}`;
          i++;
        }
      } finally {
        pulled.push('cleaned-up');
      }
    }

    const tool = createMatchToolV2();
    const { stdout } = tool.run({ pattern: 'line' }, infinite(), []);

    const first = await stdout.next();
    await stdout.return(undefined);

    const expected = true;
    const actual = !first.done && pulled.includes('cleaned-up');
    expect(actual).toBe(expected);
  });
});
