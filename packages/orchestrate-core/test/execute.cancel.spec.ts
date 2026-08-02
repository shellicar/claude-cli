import { describe, expect, it } from 'vitest';
import { fromLines } from '../src/bytes.js';
import { execute } from '../src/execute.js';
import type { Stage, ToolStage } from '../src/types.js';
import { recordingTool } from './fakeTools.js';

function toolStage(tool: ToolStage['tool'], op?: ToolStage['op']): ToolStage {
  return { kind: 'tool', tool, input: {}, op };
}

describe('execute — an already-aborted signal', () => {
  it('does not run any stage', async () => {
    const calls: unknown[] = [];
    const controller = new AbortController();
    controller.abort();
    const stages: Stage[] = [toolStage(recordingTool('a', 'none', true, calls))];

    await execute(stages, { signal: controller.signal });

    const expected = 0;
    const actual = calls.length;
    expect(actual).toBe(expected);
  });

  it('reports the un-run stage as skipped', async () => {
    const controller = new AbortController();
    controller.abort();
    const stages: Stage[] = [toolStage(recordingTool('a', 'none', true, []))];

    const { reports } = await execute(stages, { signal: controller.signal });

    const expected = 'skipped';
    const actual = reports[0].outcome;
    expect(actual).toBe(expected);
  });
});

describe('execute — signal passthrough', () => {
  it('passes the signal to a stage that has not been aborted', async () => {
    let seen: AbortSignal | undefined;
    const tool: ToolStage['tool'] = {
      name: 'a',
      operations: () => ['none'],
      run: (_input, _upstream, _stderr, signal) => {
        seen = signal;
        return { stdout: fromLines((async function* () {})()), success: () => true };
      },
    };
    const controller = new AbortController();
    const stages: Stage[] = [toolStage(tool)];

    await execute(stages, { signal: controller.signal });

    const actual = seen;
    expect(actual).toBe(controller.signal);
  });
});
