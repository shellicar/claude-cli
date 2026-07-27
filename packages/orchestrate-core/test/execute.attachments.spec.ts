import { describe, expect, it } from 'vitest';
import { execute } from '../src/execute.js';
import type { Stage, ToolStage, ToolV2 } from '../src/types.js';

function toolStage(tool: ToolStage['tool'], op?: ToolStage['op']): ToolStage {
  return { kind: 'tool', tool, input: {}, op };
}

function attachingTool(name: string, values: unknown[]): ToolV2<unknown, unknown> {
  return {
    name,
    operation: 'none',
    run: () => ({
      stdout: (async function* () {})(),
      success: () => true,
      attachments: () => values,
    }),
  };
}

describe('execute — attachments', () => {
  it('collects a stage attachment into the result', async () => {
    const stages: Stage[] = [toolStage(attachingTool('a', [{ kind: 'doc' }]))];

    const { attachments } = await execute(stages, { grant: { tiers: new Set() } });

    const expected = [{ kind: 'doc' }];
    const actual = attachments;
    expect(actual).toEqual(expected);
  });

  it('is empty when no stage produces any', async () => {
    const stages: Stage[] = [toolStage(attachingTool('a', []))];

    const { attachments } = await execute(stages, { grant: { tiers: new Set() } });

    const expected: unknown[] = [];
    const actual = attachments;
    expect(actual).toEqual(expected);
  });

  it('concatenates attachments across several stages', async () => {
    const stages: Stage[] = [toolStage(attachingTool('a', [{ kind: 'x' }])), toolStage(attachingTool('b', [{ kind: 'y' }]))];

    const { attachments } = await execute(stages, { grant: { tiers: new Set() } });

    const expected = [{ kind: 'x' }, { kind: 'y' }];
    const actual = attachments;
    expect(actual).toEqual(expected);
  });
});
