import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { execute } from '../src/execute.js';
import type { Stage, ToolV2 } from '../src/types.js';

// What a stage holds, stated as behaviour. One buffer per stage: a producer runs ahead of its
// reader by the configured amount and no more, whatever sits between them.

const BUFFER = { streamBytes: 1024, gateBytes: 64 * 1024, resultBytes: 1024 * 1024 };
const LINE = `${'x'.repeat(63)}\n`;

/** Writes as fast as it is allowed to, recording how far it got. */
function greedyWriter(name: string, written: { bytes: number }): ToolV2<unknown> {
  return {
    name,
    operations: () => ['none'],
    run: () => {
      const stream = new Readable({
        highWaterMark: BUFFER.streamBytes,
        read() {
          written.bytes += LINE.length;
          this.push(LINE);
        },
      });
      return { stdout: stream, success: () => true };
    },
  };
}

/** Reads one line and then stops, holding everything behind it still. */
function stopsAfterOne(name: string, released: Promise<void>): ToolV2<unknown> {
  return {
    name,
    operations: () => ['none'],
    run: (_input, upstream) => ({
      stdout: Readable.from(
        (async function* () {
          if (upstream == null) {
            return;
          }
          for await (const chunk of upstream) {
            yield chunk;
            await released;
          }
        })(),
        { objectMode: false, highWaterMark: BUFFER.streamBytes },
      ),
      success: () => true,
    }),
  };
}

const stage = (tool: ToolV2<unknown>, op?: '|'): Stage => ({ kind: 'tool', tool, input: {}, op });

async function settle(): Promise<void> {
  for (let turn = 0; turn < 50; turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe('how far a producer may run ahead of its reader', () => {
  it('is the configured buffer, not a multiple of it', async () => {
    const written = { bytes: 0 };
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    const running = execute([stage(greedyWriter('producer', written), '|'), stage(stopsAfterOne('consumer', held))], { buffer: BUFFER });
    await settle();
    const aheadWhileHeld = written.bytes;
    release();
    await running.catch(() => undefined);

    // One buffer at the producer, one line in flight at the reader.
    const expected = true;
    const actual = aheadWhileHeld <= BUFFER.streamBytes + LINE.length;
    expect(actual).toBe(expected);
  });

  it('grows by a fixed amount per stage, not a multiple of the buffer', async () => {
    async function aheadWith(middles: number): Promise<number> {
      const written = { bytes: 0 };
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const stages: Stage[] = [stage(greedyWriter('producer', written), '|')];
      for (let index = 0; index < middles; index++) {
        stages.push(stage(stopsAfterOne(`middle${index}`, Promise.resolve()), '|'));
      }
      stages.push(stage(stopsAfterOne('consumer', held)));

      const running = execute(stages, { buffer: BUFFER });
      await settle();
      const ahead = written.bytes;
      release();
      await running.catch(() => undefined);
      return ahead;
    }

    const [one, two] = [await aheadWith(1), await aheadWith(2)];

    // A stage that does work holds what it is reading and what it has produced, as a process in a
    // shell pipeline does. What matters is that adding one costs that and nothing more.
    const expected = true;
    const actual = two - one <= 2 * BUFFER.streamBytes;
    expect(actual).toBe(expected);
  });
});
