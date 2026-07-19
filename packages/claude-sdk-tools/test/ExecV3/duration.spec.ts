import type { CommandSpec, ExitStatus, IExecutor, SpawnOpts } from '@shellicar/exec-core';
import { describe, expect, it } from 'vitest';
import { createExecV3 } from '../../src/ExecV3/ExecV3';
import { passthroughEnvProvider } from '../../src/entry/ExecV3';
import { executor } from '../../src/exec-shared';
import { nodeFs } from '../../src/fs/nodeFs';

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
    const tool = createExecV3(nodeFs, echoExecutor, passthroughEnvProvider, [], now);
    const input = tool.input_schema.parse({ intent: 'echo hello', commands: [{ program: 'echo', args: ['hello'] }] });

    const { textContent } = await tool.handler(input);
    const expected = { command: 40, total: 70 };
    const actual = { command: textContent.results[0]?.durationMs, total: textContent.durationMs };
    expect(actual).toEqual(expected);
  });
});

// Real timing: a pipe's stages run concurrently, so the top-level durationMs is not the sum of
// the per-command ones. sleep 0.1 (the consumer) settles first and tears sleep 0.3 (the
// producer) down early via SIGPIPE, so the whole run finishes in ~0.1s, not ~0.3s.
describe('ExecV3 — pipe durationMs reflects overlap, not addition', () => {
  it('top-level durationMs is less than the sum of the per-stage durationMs', async () => {
    const tool = createExecV3(nodeFs, executor, passthroughEnvProvider);
    const input = tool.input_schema.parse({
      intent: 'pipe a slow producer into a fast consumer to show they overlap',
      commands: [
        { program: 'sleep', args: ['0.3'], op: '|' as const },
        { program: 'sleep', args: ['0.1'] },
      ],
    });

    const { textContent } = await tool.handler(input);
    const sum = (textContent.results[0]?.durationMs ?? 0) + (textContent.results[1]?.durationMs ?? 0);
    const expected = true;
    const actual = textContent.durationMs < sum;
    expect(actual).toBe(expected);
  });
});
