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

    const { result } = await execute(stages, {});

    const expected = ['acted on: a.txt', 'acted on: b.txt'];
    const actual = result;
    expect(actual).toEqual(expected);
  });

  it('does not affect a stage that has no Xargs stage before it', async () => {
    const stages: Stage[] = [{ kind: 'tool', tool: dumbFilesTool('Delete', 'fs.delete'), input: {} }];

    const { result } = await execute(stages, {});

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

    const { result } = await execute(stages, { approve: async (ctx) => ({ approved: ctx.name !== 'Producer' }) });

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

    const { result } = await execute(stages, {});

    const expected: string[] = [];
    const actual = result;
    expect(actual).toEqual(expected);
  });
});

// `find . | xargs rm -v` runs `rm -v <paths>`: the piped values join the arguments the caller
// already wrote, they don't take their place.
describe('execute — Xargs appends to what the stage already asked for', () => {
  it('keeps the values the stage supplied itself, ahead of the piped ones', async () => {
    const stages: Stage[] = [
      { kind: 'tool', tool: sourceTool('Find', ['piped.txt']), input: {}, op: '|' },
      { kind: 'xargs', parameter: 'files' },
      { kind: 'tool', tool: dumbFilesTool('Delete', 'fs.delete'), input: { files: ['own.txt'] } },
    ];

    const { result } = await execute(stages, {});

    const expected = ['acted on: own.txt', 'acted on: piped.txt'];
    const actual = result;
    expect(actual).toEqual(expected);
  });

  it('uses the piped values alone when the stage supplied none', async () => {
    const stages: Stage[] = [
      { kind: 'tool', tool: sourceTool('Find', ['piped.txt']), input: {}, op: '|' },
      { kind: 'xargs', parameter: 'files' },
      { kind: 'tool', tool: dumbFilesTool('Delete', 'fs.delete'), input: {} },
    ];

    const { result } = await execute(stages, {});

    const expected = ['acted on: piped.txt'];
    const actual = result;
    expect(actual).toEqual(expected);
  });
});

// An argument list is held whole, so it is bounded like anything else held whole. A list cut short
// is a different call from the one asked for, so the stage it was collected for does not run.
describe('execute — an argument list that outgrows what can be held', () => {
  const tiny = { streamBytes: 20, gateBytes: 20, resultBytes: 10_000 };

  it('does not run the stage it was collected for', async () => {
    const acted: string[] = [];
    const stages: Stage[] = [
      {
        kind: 'tool',
        tool: sourceTool(
          'Find',
          Array.from({ length: 100 }, (_, index) => `file${index}`),
        ),
        input: {},
        op: '|',
      },
      { kind: 'xargs', parameter: 'files' },
      { kind: 'tool', tool: dumbFilesTool('Delete', 'none'), input: {}, op: undefined },
    ];

    const { result } = await execute(stages, { buffer: tiny });

    const expected = 0;
    const actual = result.length + acted.length;
    expect(actual).toBe(expected);
  });

  it('says why on the stage that never ran', async () => {
    const stages: Stage[] = [
      {
        kind: 'tool',
        tool: sourceTool(
          'Find',
          Array.from({ length: 100 }, (_, index) => `file${index}`),
        ),
        input: {},
        op: '|',
      },
      { kind: 'xargs', parameter: 'files' },
      { kind: 'tool', tool: dumbFilesTool('Delete', 'none'), input: {}, op: undefined },
    ];

    const { reports } = await execute(stages, { buffer: tiny });

    const expected = true;
    const actual = reports[1]?.outcome === 'skipped' && (reports[1]?.message ?? '').includes('outgrew');
    expect(actual).toBe(expected);
  });
});
