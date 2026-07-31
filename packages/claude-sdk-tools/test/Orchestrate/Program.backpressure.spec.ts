import { once } from 'node:events';
import type { CommandSpec, ExitStatus, IExecutor, SpawnOpts } from '@shellicar/exec-core';
import type { Stream } from '@shellicar/orchestrate-core';
import { describe, expect, it } from 'vitest';
import { createProgramToolV2 } from '../../src/Orchestrate/tools/Program.js';
import { MemoryFileSystem } from '../MemoryFileSystem.js';

const BUFFER_BYTES = 100;
const LINES_AVAILABLE = 1000;

const env = { buildEnv: () => ({}) as NodeJS.ProcessEnv, get: () => undefined } as never;

/**
 * A process writing to a pipe: it keeps writing while there is room, and waits when there is not,
 * exactly as `write(2)` blocks on a full pipe. `written` is how far it actually got, which is what
 * says whether anything throttled it.
 */
class BlockingWriter implements IExecutor {
  public written = 0;

  public async run(_cmd: CommandSpec, opts: SpawnOpts = {}): Promise<ExitStatus> {
    const stdout = opts.stdout;
    if (stdout == null) {
      return { exitCode: 0, signal: null };
    }
    for (let index = 0; index < LINES_AVAILABLE; index++) {
      if (opts.signal?.aborted) {
        break;
      }
      const room = stdout.write(`line ${index}\n`);
      this.written++;
      if (!room) {
        await Promise.race([once(stdout, 'drain'), once(opts.signal as AbortSignal, 'abort')]);
      }
    }
    opts.stdout?.end();
    opts.stderr?.end();
    return { exitCode: 0, signal: null };
  }
}

async function takeLines(stream: Stream<string>, count: number): Promise<string[]> {
  const taken: string[] = [];
  for await (const line of stream) {
    taken.push(line);
    if (taken.length >= count) {
      break;
    }
  }
  return taken;
}

// A pipe holds a fixed amount and then makes the writer wait, which is what keeps `seq | head -3`
// from producing a hundred thousand lines nobody reads.
describe('Program — a consumer that stops reading', () => {
  it('still gets the lines it asked for when the buffer is smaller than the output', async () => {
    const tool = createProgramToolV2(new BlockingWriter(), new MemoryFileSystem(), env, BUFFER_BYTES);

    const result = tool.run({ program: 'produce', cwd: '/' }, undefined, [], undefined, undefined, env);

    const expected = ['line 0', 'line 1', 'line 2'];
    const actual = await takeLines(result.stdout, 3);
    expect(actual).toEqual(expected);
  });

  it('leaves the writer waiting on a full buffer rather than letting it run to the end', async () => {
    const writer = new BlockingWriter();
    const tool = createProgramToolV2(writer, new MemoryFileSystem(), env, BUFFER_BYTES);

    const result = tool.run({ program: 'produce', cwd: '/' }, undefined, [], undefined, undefined, env);
    await takeLines(result.stdout, 3);

    const expected = true;
    const actual = writer.written < LINES_AVAILABLE;
    expect(actual).toBe(expected);
  });
});
