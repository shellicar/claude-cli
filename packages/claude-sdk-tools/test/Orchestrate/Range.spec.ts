import type { Stream } from '@shellicar/orchestrate-core';
import { describe, expect, it } from 'vitest';
import { createRangeLeaf } from '../../src/Orchestrate/leaves/Range.js';

async function* source(values: string[]): Stream<string> {
  for (const v of values) {
    yield v;
  }
}

describe('Range leaf', () => {
  it('yields the 1-based inclusive window', async () => {
    const leaf = createRangeLeaf();
    const { stdout } = leaf.run({ start: 2, end: 4 }, source(['a', 'b', 'c', 'd', 'e']), []);

    const out: string[] = [];
    for await (const value of stdout) {
      out.push(value);
    }

    const expected = ['b', 'c', 'd'];
    const actual = out;
    expect(actual).toEqual(expected);
  });

  it('stops pulling the instant the end position is reached, not one item later', async () => {
    let pulls = 0;
    async function* infinite(): Stream<string> {
      while (true) {
        pulls++;
        yield `line${pulls}`;
      }
    }

    const leaf = createRangeLeaf();
    const { stdout } = leaf.run({ start: 2, end: 4 }, infinite(), []);

    for await (const _value of stdout) {
      // drain
    }

    const expected = 4;
    const actual = pulls;
    expect(actual).toBe(expected);
  });
});
