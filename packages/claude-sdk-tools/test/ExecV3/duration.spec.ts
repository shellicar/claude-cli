import type { CommandSpec, ExitStatus, IExecutor, SpawnOpts } from '@shellicar/exec-core';
import { describe, expect, it } from 'vitest';
import { createExecV3 } from '../../src/ExecV3/ExecV3';
import { passthroughEnvProvider } from '../../src/entry/ExecV3';
import { MemoryFileSystem } from '../MemoryFileSystem';

const echoExecutor: IExecutor = {
  run: async (cmd: CommandSpec, opts?: SpawnOpts): Promise<ExitStatus> => {
    opts?.stdout?.end(cmd.program);
    opts?.stderr?.end();
    return { exitCode: 0, signal: null };
  },
};

// The clock is injected (EngineContext.now / createExecV3's `now` param), so durationMs is
// deterministic under test instead of depending on real elapsed time. A single command makes
// exactly 4 calls in a fixed order: evaluate start, stage start, stage end, evaluate end.
describe('ExecV3 — durationMs uses the injected clock', () => {
  it('computes per-command and top-level durationMs from the clock, not real time', async () => {
    const ticks = [1000, 1010, 1050, 1070];
    const now = () => ticks.shift() as number;
    const tool = createExecV3(new MemoryFileSystem(), echoExecutor, passthroughEnvProvider, [], now);
    const input = tool.input_schema.parse({ intent: 'echo hello', commands: [{ program: 'echo', args: ['hello'] }] });

    const { textContent } = await tool.handler(input);
    const expected = { command: 40, total: 70 };
    const actual = { command: textContent.results[0]?.durationMs, total: textContent.durationMs };
    expect(actual).toEqual(expected);
  });
});

// No real spawn and no real elapsed time: durationMs is computed entirely from the injected
// clock, so a pipe's "overlap, not addition" arithmetic can be proven with a fixed clock
// sequence and manually-resolved ("spy") promises standing in for the two stages — nothing
// needs to actually take any wall-clock time. Both stages "start" on the same tick (runPipeline
// calls ctx.now() for each stage synchronously, back to back, before either's run() resolves),
// so which one settles first does not affect the assertion.
describe('ExecV3 — pipe durationMs reflects overlap, not addition', () => {
  it('top-level durationMs is less than the sum of the per-stage durationMs', async () => {
    // top-start, stage0-start, stage1-start, first-stage-end, second-stage-end, top-end
    const ticks = [0, 0, 0, 100, 120, 130];
    const now = () => ticks.shift() as number;

    let resolveProducer!: (v: ExitStatus) => void;
    let resolveConsumer!: (v: ExitStatus) => void;
    const producerDone = new Promise<ExitStatus>((resolve) => {
      resolveProducer = resolve;
    });
    const consumerDone = new Promise<ExitStatus>((resolve) => {
      resolveConsumer = resolve;
    });

    const spyExecutor: IExecutor = {
      run: async (cmd: CommandSpec, opts?: SpawnOpts): Promise<ExitStatus> => {
        opts?.stdout?.end();
        opts?.stderr?.end();
        return cmd.program === 'producer' ? producerDone : consumerDone;
      },
    };

    const tool = createExecV3(new MemoryFileSystem(), spyExecutor, passthroughEnvProvider, [], now);
    const input = tool.input_schema.parse({
      intent: 'pipe a slow producer into a fast consumer to show they overlap',
      commands: [{ program: 'producer', op: '|' as const }, { program: 'consumer' }],
    });

    const handlerPromise = tool.handler(input);
    // The consumer (fast) settles first, tearing the producer (slow) down early — same
    // shape as the real SIGPIPE teardown, just driven by hand instead of a real process.
    resolveConsumer({ exitCode: 0, signal: null });
    resolveProducer({ exitCode: 0, signal: 'SIGPIPE' });

    const { textContent } = await handlerPromise;
    const sum = (textContent.results[0]?.durationMs ?? 0) + (textContent.results[1]?.durationMs ?? 0);
    const expected = true;
    const actual = textContent.durationMs < sum;
    expect(actual).toBe(expected);
  });
});
