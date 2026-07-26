import type { Stream } from '@shellicar/orchestrate-core';
import { describe, expect, it } from 'vitest';
import { createTailToolV2 } from '../../src/Orchestrate/tools/Tail.js';

async function* source(values: string[]): Stream<string> {
  for (const v of values) {
    yield v;
  }
}

describe('Tail tool', () => {
  it('yields only the last N items, in order', async () => {
    const tool = createTailToolV2();
    const { stdout } = tool.run({ count: 2 }, source(['a', 'b', 'c']), []);

    const out: string[] = [];
    for await (const value of stdout) {
      out.push(value);
    }

    const expected = ['b', 'c'];
    const actual = out;
    expect(actual).toEqual(expected);
  });

  it('yields the whole stream when count exceeds its length', async () => {
    const tool = createTailToolV2();
    const { stdout } = tool.run({ count: 10 }, source(['a', 'b']), []);

    const out: string[] = [];
    for await (const value of stdout) {
      out.push(value);
    }

    const expected = ['a', 'b'];
    const actual = out;
    expect(actual).toEqual(expected);
  });
});
