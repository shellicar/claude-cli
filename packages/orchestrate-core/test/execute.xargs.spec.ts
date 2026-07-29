import { describe, expect, it } from 'vitest';
import { execute } from '../src/execute.js';
import type { Stage } from '../src/types.js';
import { dumbFilesTool, sourceTool } from './fakeTools.js';

describe('execute — Xargs', () => {
  it('bridges an upstream batch into a named parameter of the next stage, unaided by that tool', async () => {
    const stages: Stage[] = [
      { kind: 'tool', tool: sourceTool('Find', ['a.txt', 'b.txt']), input: {}, op: '|' },
      { kind: 'xargs', parameter: 'files' },
      { kind: 'tool', tool: dumbFilesTool('Delete', 'fs.delete'), input: {} },
    ];

    const { result } = await execute(stages, { grant: { tiers: new Set(['fs.delete']) } });

    const expected = ['acted on: a.txt', 'acted on: b.txt'];
    const actual = result;
    expect(actual).toEqual(expected);
  });

  it('does not affect a stage that has no Xargs stage before it', async () => {
    const stages: Stage[] = [{ kind: 'tool', tool: dumbFilesTool('Delete', 'fs.delete'), input: {} }];

    const { result } = await execute(stages, { grant: { tiers: new Set(['fs.delete']) } });

    const expected: string[] = [];
    const actual = result;
    expect(actual).toEqual(expected);
  });

  // A batch belongs to the stage it was collected for. If that stage never runs, the batch dies
  // with it — it must not travel on and splice itself over a later, unrelated stage's own input.
  it('does not inject a batch into a later stage when the stage it was collected for is skipped', async () => {
    const stages: Stage[] = [
      { kind: 'tool', tool: dumbFilesTool('Producer', 'fs.list'), input: { files: ['a.txt'] }, op: '|' },
      { kind: 'xargs', parameter: 'files' },
      { kind: 'tool', tool: dumbFilesTool('Consumer', 'fs.delete'), input: {} },
      { kind: 'tool', tool: dumbFilesTool('Unrelated', 'fs.delete'), input: { files: ['keep.txt'] } },
    ];

    const { result } = await execute(stages, { grant: { tiers: new Set(['fs.delete']) }, approve: async (ctx) => ({ approved: ctx.name !== 'Producer' }) });

    const expected = ['acted on: keep.txt'];
    const actual = result;
    expect(actual).toEqual(expected);
  });

  it('collects nothing when not preceded by an explicit | join, same as a tool stage would', async () => {
    const stages: Stage[] = [
      { kind: 'tool', tool: sourceTool('Find', ['a.txt']), input: {} }, // sequential, no '|'
      { kind: 'xargs', parameter: 'files' },
      { kind: 'tool', tool: dumbFilesTool('Delete', 'fs.delete'), input: {} },
    ];

    const { result } = await execute(stages, { grant: { tiers: new Set(['fs.delete']) } });

    const expected: string[] = [];
    const actual = result;
    expect(actual).toEqual(expected);
  });
});
