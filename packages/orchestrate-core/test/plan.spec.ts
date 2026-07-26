import { describe, expect, it } from 'vitest';
import { plan } from '../src/plan.js';
import type { ToolStage, ToolV2 } from '../src/types.js';

function fakeTool(operation: ToolV2<unknown, unknown>['operation']): ToolV2<unknown, unknown> {
  return {
    name: 'Fake',
    operation,
    run: (async function* () {})() as never,
  };
}

function stage(operation: ToolV2<unknown, unknown>['operation']): ToolStage {
  return { kind: 'tool', tool: fakeTool(operation), input: {} };
}

describe('plan', () => {
  it('streams a stage whose operation tier is not fs.*', () => {
    const planned = plan([stage('none')], { tiers: new Set() });

    const expected = 'stream';
    const actual = planned[0].mode;
    expect(actual).toBe(expected);
  });

  it('gates a stage whose operation tier is not in the grant', () => {
    const planned = plan([stage('fs.delete')], { tiers: new Set() });

    const expected = 'buffer-then-gate';
    const actual = planned[0].mode;
    expect(actual).toBe(expected);
  });

  it('streams a stage whose operation tier is already granted', () => {
    const planned = plan([stage('fs.delete')], { tiers: new Set(['fs.delete']) });

    const expected = 'stream';
    const actual = planned[0].mode;
    expect(actual).toBe(expected);
  });

  it('gates fs.read independently of a granted fs.list tier', () => {
    const planned = plan([stage('fs.list'), stage('fs.read')], { tiers: new Set(['fs.list']) });

    const expected = 'buffer-then-gate';
    const actual = planned[1].mode;
    expect(actual).toBe(expected);
  });
});
