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

  it('shows stderr when the STAGE opts in via showStderr, even though the tool succeeded', async () => {
    // showStderr lives on the stage, not the tool: the same GitLike tool might want its stderr
    // shown in one call and hidden in another, depending on what the caller wants from THIS run.
    const tool = stderrTool('GitLike', true, ['Switched to branch main']);
    const stages: Stage[] = [{ kind: 'tool', tool, input: {}, showStderr: true }];

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
