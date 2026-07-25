import { describe, expect, it } from 'vitest';
import { execute } from '../src/execute.js';
import type { Stage } from '../src/types.js';
import { stderrLeaf } from './fakeLeaves.js';

describe('execute — stderr surfacing policy', () => {
  it('hides stderr by default on a successful stage', async () => {
    const stages: Stage[] = [{ kind: 'leaf', leaf: stderrLeaf('Ok', true, ['diagnostic']), input: {} }];

    const { reports } = await execute(stages, { grant: { tiers: new Set() } });

    const expected = null;
    const actual = reports[0].stderrShown;
    expect(actual).toBe(expected);
  });

  it('shows stderr when the leaf opts in via showStderr, even though it succeeded', async () => {
    const leaf = { ...stderrLeaf('GitLike', true, ['Switched to branch main']), showStderr: true };
    const stages: Stage[] = [{ kind: 'leaf', leaf, input: {} }];

    const { reports } = await execute(stages, { grant: { tiers: new Set() } });

    const expected = ['Switched to branch main'];
    const actual = reports[0].stderrShown;
    expect(actual).toEqual(expected);
  });

  it('shows stderr automatically on failure, with no showStderr flag set', async () => {
    const stages: Stage[] = [{ kind: 'leaf', leaf: stderrLeaf('Failing', false, ['permission denied']), input: {} }];

    const { reports } = await execute(stages, { grant: { tiers: new Set() } });

    const expected = ['permission denied'];
    const actual = reports[0].stderrShown;
    expect(actual).toEqual(expected);
  });
});
