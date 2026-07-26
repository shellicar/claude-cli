import { describe, expect, it } from 'vitest';
import { execute } from '../src/execute.js';
import type { Stage, ToolStage } from '../src/types.js';
import { recordingTool, sourceTool } from './fakeTools.js';

function toolStage(tool: ToolStage['tool'], opts?: Partial<Pick<ToolStage, 'op' | 'captureAs' | 'input'>>): ToolStage {
  return { kind: 'tool', tool, input: opts?.input ?? {}, op: opts?.op, captureAs: opts?.captureAs };
}

describe('execute — capture and reference', () => {
  it('resolves a later stage argument from an earlier stage capture', async () => {
    const calls: unknown[] = [];
    const stages: Stage[] = [toolStage(sourceTool('AzCli', ['secret-value']), { captureAs: 'TOKEN' }), toolStage(recordingTool('curl', 'none', true, calls), { input: { header: 'Bearer $TOKEN' } })];

    await execute(stages, { grant: { tiers: new Set() } });

    const expected = 'Bearer secret-value';
    const actual = (calls[0] as { header: string }).header;
    expect(actual).toBe(expected);
  });

  it('leaves a reference with no matching capture untouched', async () => {
    const calls: unknown[] = [];
    const stages: Stage[] = [toolStage(recordingTool('curl', 'none', true, calls), { input: { header: 'Bearer $MISSING' } })];

    await execute(stages, { grant: { tiers: new Set() } });

    const expected = 'Bearer $MISSING';
    const actual = (calls[0] as { header: string }).header;
    expect(actual).toBe(expected);
  });
});
