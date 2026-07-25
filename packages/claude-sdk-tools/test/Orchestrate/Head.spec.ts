import type { Stream } from '@shellicar/orchestrate-core';
import { describe, expect, it } from 'vitest';
import { createHeadLeaf } from '../../src/Orchestrate/leaves/Head.js';

describe('Head leaf', () => {
  it('yields only the first N items', async () => {
    async function* source(): Stream<string> {
      yield 'a';
      yield 'b';
      yield 'c';
    }
    const leaf = createHeadLeaf();
    const { stdout } = leaf.run({ count: 2 }, source(), []);

    const out: string[] = [];
    for await (const value of stdout) {
      out.push(value);
    }

    const expected = ['a', 'b'];
    const actual = out;
    expect(actual).toEqual(expected);
  });

  it('pulls exactly N items from an unbounded upstream, not one more', async () => {
    let pulls = 0;
    async function* infinite(): Stream<string> {
      while (true) {
        pulls++;
        yield `line${pulls}`;
      }
    }

    const leaf = createHeadLeaf();
    const { stdout } = leaf.run({ count: 3 }, infinite(), []);

    const out: string[] = [];
    for await (const value of stdout) {
      out.push(value);
    }

    const expected = 3;
    const actual = pulls;
    expect(actual).toBe(expected);
  });
});
