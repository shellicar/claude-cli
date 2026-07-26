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
