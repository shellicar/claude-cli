import { describe, expect, it } from 'vitest';
import { execute, type VarStore } from '../src/execute.js';
import type { Stage, ToolStage } from '../src/types.js';
import { recordingTool, sourceTool } from './fakeTools.js';

function toolStage(tool: ToolStage['tool'], opts?: Partial<Pick<ToolStage, 'op' | 'captureAs' | 'input'>>): ToolStage {
  return { kind: 'tool', tool, input: opts?.input ?? {}, op: opts?.op, captureAs: opts?.captureAs };
}

/** Where a capture goes: a plain map here, the environment a run spawns under in production. */
function varStore(): VarStore & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return { values, set: (name, value) => void values.set(name, value) };
}

describe('execute — a capture', () => {
  it('is written to the run store, where a spawning tool reads it as an environment variable', async () => {
    const vars = varStore();
    const stages: Stage[] = [toolStage(sourceTool('AzCli', ['secret-value']), { captureAs: 'TOKEN' })];

    await execute(stages, { vars });

    const expected = 'secret-value';
    const actual = vars.values.get('TOKEN');
    expect(actual).toBe(expected);
  });

  // The value does reach the command that needs it, through the environment that command runs
  // under. What it must never do is get written into the stage's arguments, because those are what
  // Policy judges, what an approval request carries over the wire, and what the log records. So the
  // arguments keep the reference and the process resolves it, exactly as a shell leaves `'$TOKEN'`
  // alone and lets the child read it from its own environment.
  it('is not substituted into a later stage argument', async () => {
    const calls: unknown[] = [];
    const stages: Stage[] = [toolStage(sourceTool('AzCli', ['secret-value']), { captureAs: 'TOKEN' }), toolStage(recordingTool('curl', 'none', true, calls), { input: { header: 'Bearer $TOKEN' } })];

    await execute(stages, { vars: varStore() });

    const expected = 'Bearer $TOKEN';
    const actual = (calls[0] as { header: string }).header;
    expect(actual).toBe(expected);
  });

  it('is not substituted into an argument list either', async () => {
    const calls: unknown[] = [];
    const stages: Stage[] = [toolStage(sourceTool('AzCli', ['secret-value']), { captureAs: 'TOKEN' }), toolStage(recordingTool('curl', 'none', true, calls), { input: { args: ['--header', 'Bearer $TOKEN'] } })];

    await execute(stages, { vars: varStore() });

    const expected = ['--header', 'Bearer $TOKEN'];
    const actual = (calls[0] as { args: string[] }).args;
    expect(actual).toEqual(expected);
  });
});

// A capture belongs to the stage that declared it, so a stage in the middle of a pipe captures
// what it produced, never what the pipeline as a whole ended up emitting.
describe('execute — a capture on a piped stage', () => {
  it('captures the declaring stage output rather than the output of the pipeline it sits in', async () => {
    const vars = varStore();
    const stages: Stage[] = [toolStage(sourceTool('first', ['one', 'two']), { op: '|', captureAs: 'MIDDLE' }), toolStage(sourceTool('second', ['replaced']), { op: '|' }), toolStage(sourceTool('third', ['final']), {})];

    await execute(stages, { vars });

    const expected = 'one\ntwo';
    const actual = vars.values.get('MIDDLE');
    expect(actual).toBe(expected);
  });
});
