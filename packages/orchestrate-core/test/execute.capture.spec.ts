import { describe, expect, it } from 'vitest';
import { execute, type VarStore } from '../src/execute.js';
import type { Stage, ToolStage } from '../src/types.js';
import { recordingTool, sourceTool } from './fakeTools.js';

function toolStage(tool: ToolStage['tool'], opts?: Partial<Pick<ToolStage, 'op' | 'captureAs' | 'input'>>): ToolStage {
  return { kind: 'tool', tool, input: opts?.input ?? {}, op: opts?.op, captureAs: opts?.captureAs };
}

/** A run's variable namespace, as the real caller supplies one — a plain map here, an env-provider
 *  overlay in production. */
function varStore(initial: Record<string, string> = {}): VarStore & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial));
  return { values, get: (name) => values.get(name), set: (name, value) => void values.set(name, value) };
}

describe('execute — capture and reference', () => {
  it('resolves a later stage argument from an earlier stage capture', async () => {
    const calls: unknown[] = [];
    const stages: Stage[] = [toolStage(sourceTool('AzCli', ['secret-value']), { captureAs: 'TOKEN' }), toolStage(recordingTool('curl', 'none', true, calls), { input: { header: 'Bearer $TOKEN' } })];

    await execute(stages, { grant: { tiers: new Set() }, vars: varStore() });

    const expected = 'Bearer secret-value';
    const actual = (calls[0] as { header: string }).header;
    expect(actual).toBe(expected);
  });

  // `Program{ args: [...] }` is the case this exists for: a top-level-only pass would leave the
  // literal `$TOKEN` sitting in the argument list.
  it('resolves a reference inside an array of strings, not only a top-level field', async () => {
    const calls: unknown[] = [];
    const stages: Stage[] = [toolStage(sourceTool('AzCli', ['secret-value']), { captureAs: 'TOKEN' }), toolStage(recordingTool('curl', 'none', true, calls), { input: { args: ['--header', 'Bearer $TOKEN'] } })];

    await execute(stages, { grant: { tiers: new Set() }, vars: varStore() });

    const expected = ['--header', 'Bearer secret-value'];
    const actual = (calls[0] as { args: string[] }).args;
    expect(actual).toEqual(expected);
  });

  it('reads a variable the run started with, not only one an earlier stage captured', async () => {
    const calls: unknown[] = [];
    const stages: Stage[] = [toolStage(recordingTool('curl', 'none', true, calls), { input: { pane: '$TMUX_PANE' } })];

    await execute(stages, { grant: { tiers: new Set() }, vars: varStore({ TMUX_PANE: '%42' }) });

    const expected = '%42';
    const actual = (calls[0] as { pane: string }).pane;
    expect(actual).toBe(expected);
  });

  it('writes the capture into the run store, where a spawning tool can read it as an environment variable', async () => {
    const vars = varStore();
    const stages: Stage[] = [toolStage(sourceTool('AzCli', ['secret-value']), { captureAs: 'TOKEN' })];

    await execute(stages, { grant: { tiers: new Set() }, vars });

    const expected = 'secret-value';
    const actual = vars.values.get('TOKEN');
    expect(actual).toBe(expected);
  });

  it('leaves a reference with no matching capture untouched', async () => {
    const calls: unknown[] = [];
    const stages: Stage[] = [toolStage(recordingTool('curl', 'none', true, calls), { input: { header: 'Bearer $MISSING' } })];

    await execute(stages, { grant: { tiers: new Set() }, vars: varStore() });

    const expected = 'Bearer $MISSING';
    const actual = (calls[0] as { header: string }).header;
    expect(actual).toBe(expected);
  });
});

// A capture belongs to the stage that declared it, so a stage in the middle of a pipe captures
// what it produced, never what the pipeline as a whole ended up emitting.
describe('execute — a capture on a piped stage', () => {
  it('captures the declaring stage output rather than the output of the pipeline it sits in', async () => {
    const vars = varStore();
    const stages: Stage[] = [toolStage(sourceTool('first', ['one', 'two']), { op: '|', captureAs: 'MIDDLE' }), toolStage(sourceTool('second', ['replaced']), { op: '|' }), toolStage(sourceTool('third', ['final']), {})];

    await execute(stages, { grant: { tiers: new Set() }, vars });

    const expected = 'one\ntwo';
    const actual = vars.values.get('MIDDLE');
    expect(actual).toBe(expected);
  });
});
