import { describe, expect, it } from 'vitest';
import { execute, type VarStore } from '../src/execute.js';
import type { Stage, ToolStage } from '../src/types.js';
import { countingSourceTool, recordingTool, takeTool } from './fakeTools.js';

function toolStage(tool: ToolStage['tool'], opts?: Partial<Pick<ToolStage, 'op' | 'captureAs' | 'input'>>): ToolStage {
  return { kind: 'tool', tool, input: opts?.input ?? {}, op: opts?.op, captureAs: opts?.captureAs };
}

function varStore(): VarStore & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return { values, set: (name: string, value: string) => void values.set(name, value) };
}

// `find | head` stops find once head has what it wants. A stage's output reaches the next stage
// as it is produced, so a consumer that stops reading stops the producer with it.
describe('execute — a piped stage streams into the next', () => {
  // The producer is allowed to run ahead as far as the buffer, so what it got out is bounded by
  // what was taken plus that, rather than being an exact number.
  it('stops the producer once the consumer has read enough', async () => {
    const produced: string[] = [];
    const stages: Stage[] = [toolStage(countingSourceTool('find', ['a', 'b', 'c', 'd', 'e'], produced), { op: '|' }), toolStage(takeTool('head', 2), {})];

    await execute(stages, { buffer: { streamBytes: 2, gateBytes: 100, resultBytes: 10_000 } });

    const expected = true;
    const actual = produced.length < 5;
    expect(actual).toBe(expected);
  });

  it('emits only what the consumer took', async () => {
    const stages: Stage[] = [toolStage(countingSourceTool('find', ['a', 'b', 'c', 'd', 'e'], []), { op: '|' }), toolStage(takeTool('head', 2), {})];

    const { result } = await execute(stages, {});

    const expected = ['a', 'b'];
    const actual = result;
    expect(actual).toEqual(expected);
  });

  it('still reports how the producer went once its stream is finished with', async () => {
    const stages: Stage[] = [toolStage(countingSourceTool('find', ['a', 'b', 'c'], []), { op: '|' }), toolStage(takeTool('head', 1), {})];

    const { reports } = await execute(stages, {});

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

    await execute(stages, { vars: varStore() });

    const expected = ['a', 'b', 'c', 'd'];
    const actual = produced;
    expect(actual).toEqual(expected);
  });

  it('captures everything the stage produced, not what survived the consumer', async () => {
    const vars = varStore();
    const stages: Stage[] = [toolStage(countingSourceTool('find', ['a', 'b', 'c', 'd'], []), { op: '|', captureAs: 'ALL' }), toolStage(takeTool('head', 1), {})];

    await execute(stages, { vars });

    const expected = 'a\nb\nc\nd';
    const actual = vars.values.get('ALL');
    expect(actual).toBe(expected);
  });
});

// A pipeline's final output says nothing about the stages behind it: an empty answer could come
// from any of them, and a stage in the middle never appears at all. The count is per stage.
describe('execute — what each stage produced', () => {
  it('counts what a buffered stage produced', async () => {
    const stages: Stage[] = [toolStage(countingSourceTool('find', ['a', 'b', 'c'], []), {})];

    const { reports } = await execute(stages, {});

    const expected = 3;
    const actual = reports[0]?.emitted;
    expect(actual).toBe(expected);
  });

  // What the producer got out before it was stopped: what the consumer kept, plus however far the
  // buffer let it run ahead. A real pipe's buffer behaves the same way.
  it('counts what a streamed stage produced before its consumer stopped it', async () => {
    const stages: Stage[] = [toolStage(countingSourceTool('find', ['a', 'b', 'c', 'd', 'e'], []), { op: '|' }), toolStage(takeTool('head', 2), {})];

    const { reports } = await execute(stages, { buffer: { streamBytes: 2, gateBytes: 100, resultBytes: 10_000 } });

    const expected = true;
    const actual = (reports[0]?.emitted ?? 0) >= 2 && (reports[0]?.emitted ?? 0) < 5;
    expect(actual).toBe(expected);
  });

  it('counts the consumer separately from the producer', async () => {
    const stages: Stage[] = [toolStage(countingSourceTool('find', ['a', 'b', 'c', 'd', 'e'], []), { op: '|' }), toolStage(takeTool('head', 2), {})];

    const { reports } = await execute(stages, {});

    const expected = 2;
    const actual = reports[1]?.emitted;
    expect(actual).toBe(expected);
  });

  it('records nothing for a stage that never ran', async () => {
    const stages: Stage[] = [toolStage(recordingTool('first', 'none', false, []), { op: '&&' }), toolStage(countingSourceTool('second', ['a'], []), {})];

    const { reports } = await execute(stages, {});

    const expected = null;
    const actual = reports[1]?.emitted;
    expect(actual).toBe(expected);
  });
});
