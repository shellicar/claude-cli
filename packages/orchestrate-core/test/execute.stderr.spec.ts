import { describe, expect, it } from 'vitest';
import { execute } from '../src/execute.js';
import type { Stage } from '../src/types.js';
import { stderrTool } from './fakeTools.js';

describe('execute — stderr surfacing policy', () => {
  it('hides stderr by default on a successful stage', async () => {
    const stages: Stage[] = [{ kind: 'tool', tool: stderrTool('Ok', true, ['diagnostic']), input: {} }];

    const { reports } = await execute(stages, { grant: { tiers: new Set() } });

    const expected = null;
    const actual = reports[0].stderrShown;
    expect(actual).toBe(expected);
  });

  it('shows stderr when the tool opts in via showStderr, even though it succeeded', async () => {
    const tool = { ...stderrTool('GitLike', true, ['Switched to branch main']), showStderr: true };
    const stages: Stage[] = [{ kind: 'tool', tool, input: {} }];

    const { reports } = await execute(stages, { grant: { tiers: new Set() } });

    const expected = ['Switched to branch main'];
    const actual = reports[0].stderrShown;
    expect(actual).toEqual(expected);
  });

  it('shows stderr automatically on failure, with no showStderr flag set', async () => {
    const stages: Stage[] = [{ kind: 'tool', tool: stderrTool('Failing', false, ['permission denied']), input: {} }];

    const { reports } = await execute(stages, { grant: { tiers: new Set() } });

    const expected = ['permission denied'];
    const actual = reports[0].stderrShown;
    expect(actual).toEqual(expected);
  });
});
