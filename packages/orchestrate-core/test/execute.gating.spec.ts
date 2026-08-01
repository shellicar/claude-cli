import { describe, expect, it } from 'vitest';
import { execute } from '../src/execute.js';
import type { Stage, ToolStage } from '../src/types.js';
import { echoUpstreamTool, recordingTool, sourceTool } from './fakeTools.js';

function toolStage(tool: ToolStage['tool'], op?: ToolStage['op']): ToolStage {
  return { kind: 'tool', tool, input: {}, op };
}

describe('execute — buffer-then-gate', () => {
  it('presents the fully resolved upstream to the approval callback before the gated stage runs', async () => {
    const seen: unknown[] = [];
    const stages: Stage[] = [toolStage(sourceTool('Find', ['a.txt', 'b.txt']), '|'), toolStage(echoUpstreamTool('Delete', 'fs.delete'), undefined)];

    await execute(stages, {
      approve: async (ctx) => {
        seen.push(...(await ctx.batch()));
        return { approved: true };
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
      approve: async (ctx) => {
        seenInput = ctx.input;
        return { approved: true };
      },
    });

    const expected = { path: '/tmp/x' };
    const actual = seenInput;
    expect(actual).toEqual(expected);
  });

  it('presents everything the call does to the approval callback', async () => {
    let seenOperations: unknown;
    const stages: Stage[] = [{ kind: 'tool', tool: echoUpstreamTool('Delete', 'fs.delete'), input: {} }];

    await execute(stages, {
      approve: async (ctx) => {
        seenOperations = ctx.operations;
        return { approved: true };
      },
    });

    const expected = ['fs.delete'];
    const actual = seenOperations;
    expect(actual).toEqual(expected);
  });

  it('does not run the gated stage when approval is denied', async () => {
    const stages: Stage[] = [toolStage(sourceTool('Find', ['a.txt']), '|'), toolStage(echoUpstreamTool('Delete', 'fs.delete'), undefined)];

    const { result } = await execute(stages, { approve: async () => ({ approved: false }) });

    const expected: unknown[] = [];
    const actual = result;
    expect(actual).toEqual(expected);
  });

  // Every stage is put to the decision, including one that touches nothing. A tool saying it does
  // nothing is a claim about itself, and whether that claim is enough is exactly what is being
  // decided, so it cannot be the reason to skip deciding.
  it('asks about every stage, including one whose operation is none', async () => {
    const asked: string[] = [];
    const stages: Stage[] = [toolStage(sourceTool('Find', ['a.txt']), '|'), toolStage(echoUpstreamTool('Filter', 'none'), undefined)];

    await execute(stages, {
      approve: async (ctx) => {
        asked.push(ctx.name);
        return { approved: true };
      },
    });

    const expected = ['Find', 'Filter'];
    const actual = asked;
    expect(actual).toEqual(expected);
  });

  it('carries the operation to the decision rather than acting on it', async () => {
    const seen: string[] = [];
    const stages: Stage[] = [toolStage(echoUpstreamTool('Filter', 'none'), undefined)];

    await execute(stages, {
      approve: async (ctx) => {
        seen.push(...ctx.operations);
        return { approved: true };
      },
    });

    const expected = ['none'];
    const actual = seen;
    expect(actual).toEqual(expected);
  });
});

describe('execute — a denial reports "denied", not "skipped", and carries its message', () => {
  it('reports the denied stage as outcome "denied"', async () => {
    const stages: Stage[] = [toolStage(echoUpstreamTool('Delete', 'fs.delete'), undefined)];

    const { reports } = await execute(stages, { approve: async () => ({ approved: false, message: 'blocked by policy' }) });

    const expected = 'denied';
    const actual = reports[0].outcome;
    expect(actual).toBe(expected);
  });

  it('carries the denial message through to the report', async () => {
    const stages: Stage[] = [toolStage(echoUpstreamTool('Delete', 'fs.delete'), undefined)];

    const { reports } = await execute(stages, { approve: async () => ({ approved: false, message: 'blocked by policy' }) });

    const expected = 'blocked by policy';
    const actual = reports[0].message;
    expect(actual).toBe(expected);
  });

  it('a denial with no message carries none, rather than a placeholder', async () => {
    const stages: Stage[] = [toolStage(echoUpstreamTool('Delete', 'fs.delete'), undefined)];

    const { reports } = await execute(stages, { approve: async () => ({ approved: false }) });

    const expected = undefined;
    const actual = reports[0].message;
    expect(actual).toBe(expected);
  });
});

describe('execute — a stage piped from a denied stage is skipped, not run against fabricated empty data', () => {
  it('reports the downstream piped stage as "skipped"', async () => {
    const calls: unknown[] = [];
    const stages: Stage[] = [toolStage(echoUpstreamTool('Delete', 'fs.delete'), '|'), toolStage(recordingTool('Report', 'none', true, calls), undefined)];

    const { reports } = await execute(stages, { approve: async () => ({ approved: false }) });

    const expected = 'skipped';
    const actual = reports[1].outcome;
    expect(actual).toBe(expected);
  });

  it('never actually calls the downstream piped stage’s run at all', async () => {
    const calls: unknown[] = [];
    const stages: Stage[] = [toolStage(echoUpstreamTool('Delete', 'fs.delete'), '|'), toolStage(recordingTool('Report', 'none', true, calls), undefined)];

    await execute(stages, { approve: async () => ({ approved: false }) });

    const expected = 0;
    const actual = calls.length;
    expect(actual).toBe(expected);
  });
});

describe('execute — ; and || after a denial still run, since they never depended on its data', () => {
  it('a sequential (;) stage after a denial still runs', async () => {
    const calls: unknown[] = [];
    const stages: Stage[] = [toolStage(echoUpstreamTool('Delete', 'fs.delete'), undefined), toolStage(recordingTool('Report', 'none', true, calls), undefined)];

    await execute(stages, { approve: async (ctx) => ({ approved: ctx.name !== 'Delete' }) });

    const expected = 1;
    const actual = calls.length;
    expect(actual).toBe(expected);
  });

  it('a || fallback after a denial still runs, since a denial counts as failure for || purposes', async () => {
    const calls: unknown[] = [];
    const stages: Stage[] = [toolStage(echoUpstreamTool('Delete', 'fs.delete'), '||'), toolStage(recordingTool('Fallback', 'none', true, calls), undefined)];

    await execute(stages, { approve: async (ctx) => ({ approved: ctx.name !== 'Delete' }) });

    const expected = 1;
    const actual = calls.length;
    expect(actual).toBe(expected);
  });

  it('a && stage after a denial does not run, since a denial is not a success', async () => {
    const calls: unknown[] = [];
    const stages: Stage[] = [toolStage(echoUpstreamTool('Delete', 'fs.delete'), '&&'), toolStage(recordingTool('Next', 'none', true, calls), undefined)];

    await execute(stages, { approve: async () => ({ approved: false }) });

    const expected = 0;
    const actual = calls.length;
    expect(actual).toBe(expected);
  });
});

describe('execute — a stage piped from a control-flow-skipped stage is also skipped', () => {
  it('reports the second-order piped stage as "skipped", not run against stale or empty data', async () => {
    const failing = recordingTool('a', 'none', false, []);
    const calls: unknown[] = [];
    const stages: Stage[] = [toolStage(failing, '&&'), toolStage(sourceTool('b', ['x']), '|'), toolStage(recordingTool('c', 'none', true, calls), undefined)];

    const { reports } = await execute(stages, {});

    const expected = 'skipped';
    const actual = reports[2].outcome;
    expect(actual).toBe(expected);
  });
});
