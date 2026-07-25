import { describe, expect, it } from 'vitest';
import { execute } from '../src/execute.js';
import type { LeafStage, Stage } from '../src/types.js';
import { echoUpstreamLeaf, recordingLeaf, sourceLeaf } from './fakeLeaves.js';

function leafStage(leaf: LeafStage['leaf'], op?: LeafStage['op']): LeafStage {
  return { kind: 'leaf', leaf, input: {}, op };
}

describe('execute — && operator', () => {
  it('runs the next stage when the previous one succeeded', async () => {
    const calls: unknown[] = [];
    const stages: Stage[] = [leafStage(sourceLeaf('a', []), '&&'), leafStage(recordingLeaf('b', 'none', true, calls), undefined)];

    await execute(stages, { grant: { tiers: new Set() } });

    const expected = 1;
    const actual = calls.length;
    expect(actual).toBe(expected);
  });

  it('skips the next stage when the previous one failed', async () => {
    const calls: unknown[] = [];
    const failing = recordingLeaf('a', 'none', false, []);
    const stages: Stage[] = [leafStage(failing, '&&'), leafStage(recordingLeaf('b', 'none', true, calls), undefined)];

    await execute(stages, { grant: { tiers: new Set() } });

    const expected = 0;
    const actual = calls.length;
    expect(actual).toBe(expected);
  });
});

describe('execute — || operator', () => {
  it('runs the fallback stage when the previous one failed', async () => {
    const calls: unknown[] = [];
    const failing = recordingLeaf('a', 'none', false, []);
    const stages: Stage[] = [leafStage(failing, '||'), leafStage(recordingLeaf('b', 'none', true, calls), undefined)];

    await execute(stages, { grant: { tiers: new Set() } });

    const expected = 1;
    const actual = calls.length;
    expect(actual).toBe(expected);
  });

  it('skips the fallback stage when the previous one succeeded', async () => {
    const calls: unknown[] = [];
    const succeeding = recordingLeaf('a', 'none', true, []);
    const stages: Stage[] = [leafStage(succeeding, '||'), leafStage(recordingLeaf('b', 'none', true, calls), undefined)];

    await execute(stages, { grant: { tiers: new Set() } });

    const expected = 0;
    const actual = calls.length;
    expect(actual).toBe(expected);
  });
});

describe('execute — sequential join (no op, bash ;)', () => {
  it('does not forward the previous stage stdout as the next stage upstream', async () => {
    const stages: Stage[] = [leafStage(sourceLeaf('a', ['upstream-data']), undefined), leafStage(echoUpstreamLeaf('b'), undefined)];

    const { result } = await execute(stages, { grant: { tiers: new Set() } });

    // echoUpstreamLeaf re-yields whatever upstream it was handed — empty means it got none,
    // which is the actual bug this pins down: an earlier POC pass forwarded stdout regardless.
    const expected: string[] = [];
    const actual = result;
    expect(actual).toEqual(expected);
  });
});

describe('execute — | operator', () => {
  it('pipes the previous stage stdout into the next stage', async () => {
    const stages: Stage[] = [leafStage(sourceLeaf('a', ['piped-value']), '|'), leafStage(echoUpstreamLeaf('b'), undefined)];

    const { result } = await execute(stages, { grant: { tiers: new Set() } });

    const expected = ['piped-value'];
    const actual = result;
    expect(actual).toEqual(expected);
  });
});
