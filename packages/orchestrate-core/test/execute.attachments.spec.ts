import { describe, expect, it } from 'vitest';
import { fromLines } from '../src/bytes.js';
import { execute } from '../src/execute.js';
import type { Stage, ToolStage, ToolV2 } from '../src/types.js';

function toolStage(tool: ToolStage['tool'], op?: ToolStage['op']): ToolStage {
  return { kind: 'tool', tool, input: {}, op };
}

function attachingTool(name: string, values: unknown[]): ToolV2<unknown, unknown> {
  return {
    name,
    operations: () => ['none'],
    run: () => ({
      stdout: fromLines((async function* () {})()),
      success: () => true,
      attachments: () => values,
    }),
  };
}

describe('execute — attachments', () => {
  it('collects a stage attachment into the result', async () => {
    const stages: Stage[] = [toolStage(attachingTool('a', [{ kind: 'doc' }]))];

    const { attachments } = await execute(stages, {});

    const expected = [{ kind: 'doc' }];
    const actual = attachments;
    expect(actual).toEqual(expected);
  });

  it('is empty when no stage produces any', async () => {
    const stages: Stage[] = [toolStage(attachingTool('a', []))];

    const { attachments } = await execute(stages, {});

    const expected: unknown[] = [];
    const actual = attachments;
    expect(actual).toEqual(expected);
  });

  it('concatenates attachments across several stages', async () => {
    const stages: Stage[] = [toolStage(attachingTool('a', [{ kind: 'x' }])), toolStage(attachingTool('b', [{ kind: 'y' }]))];

    const { attachments } = await execute(stages, {});

    const expected = [{ kind: 'x' }, { kind: 'y' }];
    const actual = attachments;
    expect(actual).toEqual(expected);
  });
});
