import { fromLines, lines as toLines } from '@shellicar/orchestrate-core';
import { describe, expect, it } from 'vitest';
import { createHeadToolV2 } from '../../src/Orchestrate/tools/Head.js';

describe('Head tool', () => {
  it('yields only the first N items', async () => {
    async function* source(): AsyncGenerator<string, void, unknown> {
      yield 'a';
      yield 'b';
      yield 'c';
    }
    const tool = createHeadToolV2();
    const { stdout } = tool.run({ count: 2 }, fromLines(source()), []);

    const out: string[] = [];
    for await (const value of toLines(stdout)) {
      out.push(String(value));
    }

    const expected = ['a', 'b'];
    const actual = out;
    expect(actual).toEqual(expected);
  });

  it('stops an unbounded upstream once it has what it asked for', async () => {
    let pulls = 0;
    async function* infinite(): AsyncGenerator<string, void, unknown> {
      while (true) {
        pulls++;
        yield `line${pulls}`;
      }
    }

    const tool = createHeadToolV2();
    const { stdout } = tool.run({ count: 3 }, fromLines(infinite()), []);

    const out: string[] = [];
    for await (const value of toLines(stdout)) {
      out.push(String(value));
    }

    // Stopped, not drained. Not an exact count: the medium between stages is bytes, so a producer
    // fills a chunk ahead of its reader the way it would against a real pipe.
    const expected = true;
    const actual = pulls > 0 && pulls <= 5;
    expect(actual).toBe(expected);
  });
});
