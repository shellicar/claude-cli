import { describe, expect, it } from 'vitest';
import { planStages, type ToolFacts, type WireStage } from '../../src/Orchestrate/stagePlan.js';

// The whole point of the facts lookup: the sequence rules can be stated against tools that don't
// exist, with no registry, no schemas and no zod.
const tools: Record<string, ToolFacts> = {
  Producer: { readsUpstream: false },
  Filter: { readsUpstream: true },
  Consumer: { xargsTarget: 'files', xargsTargetRequired: true, readsUpstream: false },
  Both: { xargsTarget: 'args', readsUpstream: true },
};

function plan(stages: WireStage[]) {
  return planStages(stages, (name) => tools[name]);
}

function issues(stages: WireStage[]): string[] {
  const result = plan(stages);
  return result.ok ? [] : result.issues.map((issue) => issue.message);
}

describe('planning a sequence that holds together', () => {
  it('accepts a single stage that supplies its own argument list', () => {
    const expected = true;
    const actual = plan([{ tool: 'Consumer', input: { files: ['a'] } }]).ok;
    expect(actual).toBe(expected);
  });

  it('tells the following stage which of its fields the Xargs fills', () => {
    const result = plan([{ tool: 'Producer', input: {}, op: '|' }, { xargs: true }, { tool: 'Consumer', input: {} }]);

    const expected = 'files';
    const actual = result.ok && result.stages[1]?.kind === 'xargs' ? result.stages[1].parameter : undefined;
    expect(actual).toBe(expected);
  });

  it('marks the fed stage as fed, so nothing downstream rediscovers it', () => {
    const result = plan([{ tool: 'Producer', input: {}, op: '|' }, { xargs: true }, { tool: 'Consumer', input: {} }]);

    const expected = 'files';
    const actual = result.ok && result.stages[2]?.kind === 'tool' ? result.stages[2].fedBy : undefined;
    expect(actual).toBe(expected);
  });

  it('accepts a pipe into a tool that reads one', () => {
    const expected = true;
    const actual = plan([
      { tool: 'Producer', input: {}, op: '|' },
      { tool: 'Filter', input: {} },
    ]).ok;
    expect(actual).toBe(expected);
  });

  it('accepts a fed stage that also names arguments of its own', () => {
    const expected = true;
    const actual = plan([{ tool: 'Producer', input: {}, op: '|' }, { xargs: true }, { tool: 'Consumer', input: { files: ['own'] } }]).ok;
    expect(actual).toBe(expected);
  });
});

describe('planning a sequence that does not', () => {
  it('reports a stage missing the argument list nothing will fill', () => {
    const expected = ['Consumer needs files, either supplied here or fed by an Xargs stage before it.'];
    const actual = issues([{ tool: 'Consumer', input: {} }]);
    expect(actual).toEqual(expected);
  });

  it('reports an Xargs aimed at a tool with no argument list', () => {
    const expected = ['Xargs cannot feed Filter: it takes no argument list. Pipe into it directly if it reads a pipe, or drop the Xargs.'];
    const actual = issues([{ tool: 'Producer', input: {}, op: '|' }, { xargs: true }, { tool: 'Filter', input: {} }]);
    expect(actual).toEqual(expected);
  });

  it('reports an Xargs with nothing following it', () => {
    const expected = ['Xargs must be followed by the tool stage it feeds.'];
    const actual = issues([{ tool: 'Producer', input: {}, op: '|' }, { xargs: true }]);
    expect(actual).toEqual(expected);
  });

  it('reports a pipe whose output the next stage cannot read', () => {
    const expected = ["Producer pipes into Consumer, which does not read a pipe, so its output would be discarded. Put an Xargs stage between them to append the piped values to Consumer's files."];
    const actual = issues([
      { tool: 'Producer', input: {}, op: '|' },
      { tool: 'Consumer', input: { files: ['a'] } },
    ]);
    expect(actual).toEqual(expected);
  });

  it('blames the stage carrying the op, since that is where the mistake is written', () => {
    const result = plan([
      { tool: 'Producer', input: {}, op: '|' },
      { tool: 'Consumer', input: { files: ['a'] } },
    ]);

    const expected = ['stages', 0, 'op'];
    const actual = result.ok ? undefined : result.issues[0]?.path;
    expect(actual).toEqual(expected);
  });

  it('reports a trailing op with nothing after it', () => {
    const expected = ['The last stage must not have an op set — there is nothing after it to join to.'];
    const actual = issues([
      { tool: 'Producer', input: {}, op: '|' },
      { tool: 'Filter', input: {}, op: '&&' },
    ]);
    expect(actual).toEqual(expected);
  });

  it('reports every problem in the sequence, not only the first', () => {
    const expected = 2;
    const actual = issues([
      { tool: 'Producer', input: {}, op: '|' },
      { tool: 'Consumer', input: {} },
    ]).length;
    expect(actual).toBe(expected);
  });
});

// A tool can both read a pipe and take an argument list; which it gets is the caller's choice,
// expressed by whether an Xargs sits between them.
describe('planning around a tool that could take either', () => {
  it('lets a pipe reach it directly', () => {
    const expected = true;
    const actual = plan([
      { tool: 'Producer', input: {}, op: '|' },
      { tool: 'Both', input: {} },
    ]).ok;
    expect(actual).toBe(expected);
  });

  it('lets an Xargs fill its argument list instead', () => {
    const result = plan([{ tool: 'Producer', input: {}, op: '|' }, { xargs: true }, { tool: 'Both', input: {} }]);

    const expected = 'args';
    const actual = result.ok && result.stages[1]?.kind === 'xargs' ? result.stages[1].parameter : undefined;
    expect(actual).toBe(expected);
  });
});
