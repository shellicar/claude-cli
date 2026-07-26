import { describe, expect, it } from 'vitest';
import { execute } from '../src/execute.js';
import type { Stage, ToolStage } from '../src/types.js';
import { echoUpstreamTool, sourceTool } from './fakeTools.js';

function toolStage(tool: ToolStage['tool'], op?: ToolStage['op']): ToolStage {
  return { kind: 'tool', tool, input: {}, op };
}

describe('execute — buffer-then-gate', () => {
  it('presents the fully resolved upstream to the approval callback before the gated stage runs', async () => {
    const seen: unknown[] = [];
    const stages: Stage[] = [toolStage(sourceTool('Find', ['a.txt', 'b.txt']), '|'), toolStage(echoUpstreamTool('Delete', 'fs.delete'), undefined)];

    await execute(stages, {
      grant: { tiers: new Set() },
      approve: async (ctx) => {
        seen.push(...ctx.batch);
        return true;
      },
    });

    const expected = ['a.txt', 'b.txt'];
    const actual = seen;
    expect(actual).toEqual(expected);
  });

  it('presents the stage’s own resolved input to the approval callback, not just its upstream', async () => {
    let seenInput: unknown;
    const stages: Stage[] = [{ kind: 'tool', tool: echoUpstreamTool('Delete', 'fs.delete'), input: { path: '/tmp/x' } }];

    await execute(stages, {
      grant: { tiers: new Set() },
      approve: async (ctx) => {
        seenInput = ctx.input;
        return true;
      },
    });

    const expected = { path: '/tmp/x' };
    const actual = seenInput;
    expect(actual).toEqual(expected);
  });

  it('presents the stage’s own operation to the approval callback', async () => {
    let seenOperation: unknown;
    const stages: Stage[] = [{ kind: 'tool', tool: echoUpstreamTool('Delete', 'fs.delete'), input: {} }];

    await execute(stages, {
      grant: { tiers: new Set() },
      approve: async (ctx) => {
        seenOperation = ctx.operation;
        return true;
      },
    });

    const expected = 'fs.delete';
    const actual = seenOperation;
    expect(actual).toBe(expected);
  });

  it('does not run the gated stage when approval is denied', async () => {
    const stages: Stage[] = [toolStage(sourceTool('Find', ['a.txt']), '|'), toolStage(echoUpstreamTool('Delete', 'fs.delete'), undefined)];

    const { result } = await execute(stages, { grant: { tiers: new Set() }, approve: async () => false });

    const expected: unknown[] = [];
    const actual = result;
    expect(actual).toEqual(expected);
  });

  it('does not gate a stage whose operation tier is already granted', async () => {
    let approvalCalled = false;
    const stages: Stage[] = [toolStage(sourceTool('Find', ['a.txt']), '|'), toolStage(echoUpstreamTool('Delete', 'fs.delete'), undefined)];

    await execute(stages, {
      grant: { tiers: new Set(['fs.delete']) },
      approve: async () => {
        approvalCalled = true;
        return true;
      },
    });

    const expected = false;
    const actual = approvalCalled;
    expect(actual).toBe(expected);
  });
});
