import { describe, expect, it } from 'vitest';
import { group } from '../../src/ExecV3/group';
import { ExecV3InputSchema } from '../../src/ExecV3/schema';
import type { Command } from '../../src/ExecV3/types';

// Parse through the schema so each command carries its defaults (args: []),
// matching what the engine receives at runtime.
function parseCommands(commands: unknown[]): Command[] {
  return ExecV3InputSchema.parse({ intent: 'group test', commands }).commands;
}

// a | b && c | d  → two pipelines [a,b] and [c,d], one connector '&&'
describe('group — a | b && c | d', () => {
  const commands = parseCommands([{ program: 'a', op: '|' }, { program: 'b', op: '&&' }, { program: 'c', op: '|' }, { program: 'd' }]);

  it('produces two pipelines', () => {
    const expected = 2;
    const actual = group(commands).pipelines.length;
    expect(actual).toBe(expected);
  });

  it('first pipeline holds the first two stages', () => {
    const expected = ['a', 'b'];
    const actual = group(commands).pipelines[0].commands.map((c) => c.program);
    expect(actual).toEqual(expected);
  });

  it('second pipeline holds the last two stages', () => {
    const expected = ['c', 'd'];
    const actual = group(commands).pipelines[1].commands.map((c) => c.program);
    expect(actual).toEqual(expected);
  });

  it('the connector between the pipelines is &&', () => {
    const expected = ['&&'];
    const actual = group(commands).connectors;
    expect(actual).toEqual(expected);
  });

  it('preserves the original indices of the second pipeline', () => {
    const expected = [2, 3];
    const actual = group(commands).pipelines[1].indices;
    expect(actual).toEqual(expected);
  });
});
