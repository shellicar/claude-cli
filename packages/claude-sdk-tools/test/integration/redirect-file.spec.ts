import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ExecV3 } from '../../src/entry/ExecV3';
import { call } from '../helpers';

// A stdout redirect is the one shape where the caller reads the result off disk instead of out
// of the tool's own output, so it rests entirely on the executor having flushed and closed the
// file before the call returns. A single command is also the arity with the least coverage
// here: every other redirect test in the repo runs against the fake, which writes no files.

const target = join(tmpdir(), 'execv3-redirect-file.log');

describe('a single command redirecting stdout to a file', () => {
  afterEach(() => {
    rmSync(target, { force: true });
  });

  it('has written the file by the time the call returns', async () => {
    await call(ExecV3, { intent: 'write stdout to a file', commands: [{ program: 'echo', args: ['written'], redirect: { stdout: target } }] });

    const expected = 'written\n';
    const actual = readFileSync(target, 'utf8');
    expect(actual).toBe(expected);
  });

  it('captures nothing itself, because the output went to the file', async () => {
    const result = await call(ExecV3, { intent: 'write stdout to a file', commands: [{ program: 'echo', args: ['written'], redirect: { stdout: target } }] });

    const expected = '';
    const actual = result.results[0]?.stdout;
    expect(actual).toBe(expected);
  });
});
