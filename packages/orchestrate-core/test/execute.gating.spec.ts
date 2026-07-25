import { describe, expect, it } from 'vitest';
import { execute } from '../src/execute.js';
import type { LeafStage, Stage } from '../src/types.js';
import { echoUpstreamLeaf, sourceLeaf } from './fakeLeaves.js';

function leafStage(leaf: LeafStage['leaf'], op?: LeafStage['op']): LeafStage {
  return { kind: 'leaf', leaf, input: {}, op };
}

describe('execute — buffer-then-gate', () => {
  it('presents the fully resolved upstream to the approval callback before the gated stage runs', async () => {
    const seen: unknown[] = [];
    const stages: Stage[] = [leafStage(sourceLeaf('Find', ['a.txt', 'b.txt']), '|'), leafStage(echoUpstreamLeaf('Delete', 'fs.delete'), undefined)];

    await execute(stages, {
      grant: { tiers: new Set() },
      approve: async (_name, batch) => {
        seen.push(...batch);
        return true;
      },
    });

    const expected = ['a.txt', 'b.txt'];
    const actual = seen;
    expect(actual).toEqual(expected);
  });

  it('does not run the gated stage when approval is denied', async () => {
    const stages: Stage[] = [leafStage(sourceLeaf('Find', ['a.txt']), '|'), leafStage(echoUpstreamLeaf('Delete', 'fs.delete'), undefined)];

    const { result } = await execute(stages, { grant: { tiers: new Set() }, approve: async () => false });

    const expected: unknown[] = [];
    const actual = result;
    expect(actual).toEqual(expected);
  });

  it('does not gate a stage whose operation tier is already granted', async () => {
    let approvalCalled = false;
    const stages: Stage[] = [leafStage(sourceLeaf('Find', ['a.txt']), '|'), leafStage(echoUpstreamLeaf('Delete', 'fs.delete'), undefined)];

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
