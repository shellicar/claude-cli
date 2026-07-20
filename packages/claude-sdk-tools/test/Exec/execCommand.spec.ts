import { beforeAll, describe, expect, it } from 'vitest';
import { execCommand } from '../../src/Exec/execCommand';
import type { Command } from '../../src/Exec/types';
import { FakeExecutor } from '../FakeExecutor';
import { MemoryFileSystem } from '../MemoryFileSystem';

// A megabyte of stdout is well past the PassThrough and OS pipe buffers in the real
// executor. FakeExecutor writes synchronously (no child process, no buffer to fill), so
// this no longer proves the concurrent-drain behaviour end-to-end the way a real spawn
// did — it only proves execCommand collects whatever the executor hands it, at any size.
describe('execCommand', () => {
  it('captures output larger than the stream buffer without deadlocking', async () => {
    const expected = 1_000_000;
    const executor = new FakeExecutor(() => ({ stdout: 'x'.repeat(1_000_000) }));
    const fs = new MemoryFileSystem();
    const cmd = {
      program: 'big-output',
      args: [],
      merge_stderr: false,
    } satisfies Command;

    const actual = await execCommand(cmd, '/cwd', undefined, executor, fs);

    expect(actual.stdout.length).toBe(expected);
  });
});

// merge_stderr + a stdout redirect points stderr at the same sink as stdout (the
// redirect file), matching a shell `cmd > file 2>&1`. Both streams land in the file and
// nothing is captured into the result.
describe('execCommand merge_stderr + redirect:stdout', () => {
  const redirectPath = '/cwd/out.txt';
  let fs: MemoryFileSystem;
  let result: Awaited<ReturnType<typeof execCommand>>;

  beforeAll(async () => {
    fs = new MemoryFileSystem();
    const executor = new FakeExecutor(() => ({ stdout: 'OUT\n', stderr: 'ERR\n' }));
    const cmd = {
      program: 'noisy',
      args: [],
      merge_stderr: true,
      redirect: { path: redirectPath, stream: 'stdout', append: false },
    } satisfies Command;

    result = await execCommand(cmd, '/cwd', undefined, executor, fs);
  });

  it('leaves result.stdout empty (stdout went to the redirect)', () => {
    const expected = '';
    const actual = result.stdout;
    expect(actual).toBe(expected);
  });

  it('writes stdout to the redirect file', async () => {
    const actual = await fs.readFile(redirectPath);
    expect(actual).toContain('OUT');
  });

  it('writes the merged stderr to the redirect file', async () => {
    const actual = await fs.readFile(redirectPath);
    expect(actual).toContain('ERR');
  });
});
