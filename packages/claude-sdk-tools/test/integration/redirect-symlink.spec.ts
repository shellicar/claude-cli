import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ExecV3 } from '../../src/entry/ExecV3';
import { call } from '../helpers';

// Two paths that name one file only once a link is followed. Nothing about how they were written
// gives it away, so this needs a real symlink on a real filesystem: the memory fake resolves every
// path to itself, which would make the test pass without proving anything.

describe('stdout and stderr pointed at one file through a symlink', () => {
  let dir: string;
  let real: string;
  let link: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'execv3-symlink-'));
    real = join(dir, 'real.log');
    link = join(dir, 'link.log');
    writeFileSync(real, '');
    symlinkSync(real, link);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('is refused rather than losing one of the streams', async () => {
    const result = await call(ExecV3, { intent: 'redirect stdout at a file and stderr at a link to it', commands: [{ program: 'echo', args: ['x'], redirect: { stdout: real, stderr: link } }] });

    const expected = false;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('says both resolve to the same file', async () => {
    const result = await call(ExecV3, { intent: 'redirect stdout at a file and stderr at a link to it', commands: [{ program: 'echo', args: ['x'], redirect: { stdout: real, stderr: link } }] });

    const expected = true;
    const actual = result.results[0]?.stderr.includes('both resolve to') ?? false;
    expect(actual).toBe(expected);
  });

  it('still allows two genuinely different files in the same directory', async () => {
    const result = await call(ExecV3, { intent: 'redirect the two streams at two different files', commands: [{ program: 'echo', args: ['x'], redirect: { stdout: join(dir, 'out.log'), stderr: join(dir, 'err.log') } }] });

    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });
});
