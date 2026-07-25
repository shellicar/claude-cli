import { describe, expect, it } from 'vitest';
import { execute } from '../src/execute.js';
import type { LeafStage, Stage } from '../src/types.js';
import { recordingLeaf, sourceLeaf } from './fakeLeaves.js';

function leafStage(leaf: LeafStage['leaf'], opts?: Partial<Pick<LeafStage, 'op' | 'captureAs' | 'input'>>): LeafStage {
  return { kind: 'leaf', leaf, input: opts?.input ?? {}, op: opts?.op, captureAs: opts?.captureAs };
}

describe('execute — capture and reference', () => {
  it('resolves a later stage argument from an earlier stage capture', async () => {
    const calls: unknown[] = [];
    const stages: Stage[] = [leafStage(sourceLeaf('AzCli', ['secret-value']), { captureAs: 'TOKEN' }), leafStage(recordingLeaf('curl', 'none', true, calls), { input: { header: 'Bearer $TOKEN' } })];

    await execute(stages, { grant: { tiers: new Set() } });

    const expected = 'Bearer secret-value';
    const actual = (calls[0] as { header: string }).header;
    expect(actual).toBe(expected);
  });

  it('leaves a reference with no matching capture untouched', async () => {
    const calls: unknown[] = [];
    const stages: Stage[] = [leafStage(recordingLeaf('curl', 'none', true, calls), { input: { header: 'Bearer $MISSING' } })];

    await execute(stages, { grant: { tiers: new Set() } });

    const expected = 'Bearer $MISSING';
    const actual = (calls[0] as { header: string }).header;
    expect(actual).toBe(expected);
  });
});
