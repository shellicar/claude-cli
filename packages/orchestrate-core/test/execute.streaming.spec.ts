import { describe, expect, it } from 'vitest';
import { execute, type VarStore } from '../src/execute.js';
import type { Stage, ToolStage } from '../src/types.js';
import { countingSourceTool, takeTool } from './fakeTools.js';

function toolStage(tool: ToolStage['tool'], opts?: Partial<Pick<ToolStage, 'op' | 'captureAs' | 'input'>>): ToolStage {
  return { kind: 'tool', tool, input: opts?.input ?? {}, op: opts?.op, captureAs: opts?.captureAs };
}

function varStore(): VarStore & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return { values, get: (name) => values.get(name), set: (name, value) => void values.set(name, value) };
}

// `find | head` stops find once head has what it wants. A stage's output reaches the next stage
// as it is produced, so a consumer that stops reading stops the producer with it.
describe('execute — a piped stage streams into the next', () => {
  it('stops the producer once the consumer has read enough', async () => {
    const produced: string[] = [];
    const stages: Stage[] = [toolStage(countingSourceTool('find', ['a', 'b', 'c', 'd', 'e'], produced), { op: '|' }), toolStage(takeTool('head', 2), {})];

    await execute(stages, { grant: { tiers: new Set() } });

    const expected = ['a', 'b', 'c'];
    const actual = produced;
    expect(actual).toEqual(expected);
  });

  it('emits only what the consumer took', async () => {
    const stages: Stage[] = [toolStage(countingSourceTool('find', ['a', 'b', 'c', 'd', 'e'], []), { op: '|' }), toolStage(takeTool('head', 2), {})];

    const { result } = await execute(stages, { grant: { tiers: new Set() } });

    const expected = ['a', 'b'];
    const actual = result;
    expect(actual).toEqual(expected);
  });

  it('still reports how the producer went once its stream is finished with', async () => {
    const stages: Stage[] = [toolStage(countingSourceTool('find', ['a', 'b', 'c'], []), { op: '|' }), toolStage(takeTool('head', 1), {})];

    const { reports } = await execute(stages, { grant: { tiers: new Set() } });

    const expected = true;
    const actual = reports[0]?.success;
    expect(actual).toBe(expected);
  });
});

// A capture is the stage's whole output as one value, so a stage that declares one cannot be
// left to stream: there is nothing to capture until it has produced everything.
describe('execute — a capture forces the stage to run to completion', () => {
  it('runs the producer to the end even though its consumer stops early', async () => {
    const produced: string[] = [];
    const stages: Stage[] = [toolStage(countingSourceTool('find', ['a', 'b', 'c', 'd'], produced), { op: '|', captureAs: 'ALL' }), toolStage(takeTool('head', 1), {})];

    await execute(stages, { grant: { tiers: new Set() }, vars: varStore() });

    const expected = ['a', 'b', 'c', 'd'];
    const actual = produced;
    expect(actual).toEqual(expected);
  });

  it('captures everything the stage produced, not what survived the consumer', async () => {
    const vars = varStore();
    const stages: Stage[] = [toolStage(countingSourceTool('find', ['a', 'b', 'c', 'd'], []), { op: '|', captureAs: 'ALL' }), toolStage(takeTool('head', 1), {})];

    await execute(stages, { grant: { tiers: new Set() }, vars });

    const expected = 'a\nb\nc\nd';
    const actual = vars.values.get('ALL');
    expect(actual).toBe(expected);
  });
});
