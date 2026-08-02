import { fromLines, lines as toLines } from '@shellicar/orchestrate-core';
import { describe, expect, it } from 'vitest';
import { createRangeToolV2 } from '../../src/Orchestrate/tools/Range.js';

async function* source(values: string[]): AsyncGenerator<string, void, unknown> {
  for (const v of values) {
    yield v;
  }
}

describe('Range tool', () => {
  it('yields the 1-based inclusive window', async () => {
    const tool = createRangeToolV2();
    const { stdout } = tool.run({ start: 2, end: 4 }, fromLines(source(['a', 'b', 'c', 'd', 'e'])), []);

    const out: string[] = [];
    for await (const value of toLines(stdout)) {
      out.push(String(value));
    }

    const expected = ['b', 'c', 'd'];
    const actual = out;
    expect(actual).toEqual(expected);
  });

  it('stops pulling once the end position is reached', async () => {
    let pulls = 0;
    async function* infinite(): AsyncGenerator<string, void, unknown> {
      while (true) {
        pulls++;
        yield `line${pulls}`;
      }
    }

    const tool = createRangeToolV2();
    const { stdout } = tool.run({ start: 2, end: 4 }, fromLines(infinite()), []);

    for await (const _value of toLines(stdout)) {
      // drain
    }

    // Stopped, not drained. Not an exact count: bytes flow a chunk at a time, so the producer runs
    // slightly ahead of the reader, as it would against a real pipe.
    const expected = true;
    const actual = pulls > 0 && pulls <= 6;
    expect(actual).toBe(expected);
  });
});
