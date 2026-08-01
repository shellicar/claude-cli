import { describe, expect, it } from 'vitest';
import { execute } from '../src/execute.js';
import type { Stage, ToolStage } from '../src/types.js';
import { closeRecordingTool, signallingSourceTool, sourceTool, takeTool, throwingTool } from './fakeTools.js';

function toolStage(tool: ToolStage['tool'], op?: ToolStage['op']): ToolStage {
  return { kind: 'tool', tool, input: {}, op };
}

// A producer killed because its reader walked away ended on a signal. That is a different thing
// from the tool going wrong, and the report says which.
describe('execute — a stage that ends on a signal', () => {
  it('reports the signal it ended on', async () => {
    const stages: Stage[] = [toolStage(signallingSourceTool('producer', ['a', 'b', 'c']), '|'), toolStage(takeTool('head', 1), undefined)];

    const { reports } = await execute(stages, {});

    const expected = 'SIGPIPE';
    const actual = reports[0]?.signal;
    expect(actual).toBe(expected);
  });

  it('reports no signal for a stage that ended on its own', async () => {
    const stages: Stage[] = [toolStage(sourceTool('producer', ['a']), undefined)];

    const { reports } = await execute(stages, {});

    const expected = null;
    const actual = reports[0]?.signal;
    expect(actual).toBe(expected);
  });
});

// A suspended producer is a process nobody has told to stop, so the way out of `execute` matters as
// much as the way through it.
describe('execute — when a stage throws', () => {
  it('closes the stream of the stage feeding it', async () => {
    const closed = { value: false };
    const stages: Stage[] = [toolStage(closeRecordingTool('producer', closed), '|'), toolStage(throwingTool('boom'), undefined)];

    await expect(execute(stages, {})).rejects.toThrow('stage exploded');

    const expected = true;
    const actual = closed.value;
    expect(actual).toBe(expected);
  });
});
