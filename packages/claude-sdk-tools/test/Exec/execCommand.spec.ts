import { Executor } from '@shellicar/exec-core';
import { describe, expect, it } from 'vitest';
import { execCommand } from '../../src/Exec/execCommand';
import type { Command } from '../../src/Exec/types';

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

    const actual = await execCommand(cmd, process.cwd(), undefined, executor);

    expect(actual.stdout.length).toBe(expected);
  });
});
