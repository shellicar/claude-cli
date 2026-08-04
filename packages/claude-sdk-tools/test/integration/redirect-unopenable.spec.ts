import { describe, expect, it } from 'vitest';
import { ExecV3 } from '../../src/entry/ExecV3';
import { call } from '../helpers';

// A redirect that cannot be opened must not be reported as success. The output has nowhere to
// go, so a caller told the command succeeded will believe a file exists that never did, and
// act on it. Bash refuses the command outright; the requirement here is only that the failure
// reaches the caller instead of being swallowed.

const unopenable = '/nonexistent-dir-xyzzy-redirect/out.log';

describe('a stdout redirect that cannot be opened', () => {
  it('does not report success', async () => {
    const result = await call(ExecV3, { intent: 'redirect stdout to a path that cannot be opened', commands: [{ program: 'echo', args: ['this-should-not-vanish'], redirect: { stdout: unopenable } }] });

    const expected = false;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('says why it failed', async () => {
    const result = await call(ExecV3, { intent: 'redirect stdout to a path that cannot be opened', commands: [{ program: 'echo', args: ['this-should-not-vanish'], redirect: { stdout: unopenable } }] });

    const expected = true;
    const actual = (result.results[0]?.stderr.length ?? 0) > 0;
    expect(actual).toBe(expected);
  });
});
