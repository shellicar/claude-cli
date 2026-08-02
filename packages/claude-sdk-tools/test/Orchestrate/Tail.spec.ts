import { fromLines, lines as toLines } from '@shellicar/orchestrate-core';
import { describe, expect, it } from 'vitest';
import { createTailToolV2 } from '../../src/Orchestrate/tools/Tail.js';

async function* source(values: string[]): AsyncGenerator<string, void, unknown> {
  for (const v of values) {
    yield v;
  }
}

describe('Tail tool', () => {
  it('yields only the last N items, in order', async () => {
    const tool = createTailToolV2();
    const { stdout } = tool.run({ count: 2 }, fromLines(source(['a', 'b', 'c'])), []);

    const out: string[] = [];
    for await (const value of toLines(stdout)) {
      out.push(String(value));
    }

    const expected = ['b', 'c'];
    const actual = out;
    expect(actual).toEqual(expected);
  });

  it('yields the whole stream when count exceeds its length', async () => {
    const tool = createTailToolV2();
    const { stdout } = tool.run({ count: 10 }, fromLines(source(['a', 'b'])), []);

    const out: string[] = [];
    for await (const value of toLines(stdout)) {
      out.push(String(value));
    }

    const expected = ['a', 'b'];
    const actual = out;
    expect(actual).toEqual(expected);
  });
});
