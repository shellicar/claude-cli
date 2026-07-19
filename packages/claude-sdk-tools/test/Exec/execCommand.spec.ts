import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Executor } from '@shellicar/exec-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execCommand } from '../../src/Exec/execCommand';
import type { Command } from '../../src/Exec/types';
import { nodeFs } from '../../src/fs/nodeFs';

describe('execCommand', () => {
  // A megabyte is well past the PassThrough and OS pipe buffers. If execCommand
  // collected output *after* awaiting the run instead of concurrently, the child
  // would block on a full buffer, never exit, and this test would hang to the
  // timeout — going red. The concurrent Promise.all keeps it green.
  it('captures output larger than the stream buffer without deadlocking', async () => {
    const expected = 1_000_000;
    const executor = new Executor();
    const cmd = {
      program: 'node',
      args: ['-e', "process.stdout.write('x'.repeat(1000000))"],
      merge_stderr: false,
    } satisfies Command;

    const actual = await execCommand(cmd, process.cwd(), undefined, executor, nodeFs);

    expect(actual.stdout.length).toBe(expected);
  });
});

// merge_stderr + a stdout redirect points stderr at the same sink as stdout (the
// redirect file), matching a shell `cmd > file 2>&1`. Both streams land in the
// file and nothing is captured into the result. Reading the file is deterministic
// because execCommand now awaits the sink's flush before resolving.
describe('execCommand merge_stderr + redirect:stdout', () => {
  let dir: string;
  let redirectPath: string;
  let result: Awaited<ReturnType<typeof execCommand>>;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'exec-merge-redirect-'));
    redirectPath = join(dir, 'out.txt');
    const executor = new Executor();
    const cmd = {
      program: 'sh',
      args: ['-c', 'echo OUT; echo ERR >&2'],
      merge_stderr: true,
      redirect: { path: redirectPath, stream: 'stdout', append: false },
    } satisfies Command;

    result = await execCommand(cmd, process.cwd(), undefined, executor, nodeFs);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('leaves result.stdout empty (stdout went to the redirect)', () => {
    const expected = '';
    const actual = result.stdout;
    expect(actual).toBe(expected);
  });

  it('writes stdout to the redirect file', () => {
    const actual = readFileSync(redirectPath, 'utf8');
    expect(actual).toContain('OUT');
  });

  it('writes the merged stderr to the redirect file', () => {
    const actual = readFileSync(redirectPath, 'utf8');
    expect(actual).toContain('ERR');
  });
});
