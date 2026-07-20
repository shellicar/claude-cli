import { PassThrough, Readable } from 'node:stream';
import { Executor, type IExecutor } from '@shellicar/exec-core';
import { describe, expect, it } from 'vitest';
import { FakeExecutor, shellLikeResponder } from '../FakeExecutor';

// Pins FakeExecutor's shellLikeResponder to what the real Executor actually does, for every
// case the fake claims to model. Runs the same case against both, so a drift (the fake stops
// matching reality, or Executor.ts changes a message) goes red here instead of staying
// silently stale in whichever fake-based unit test happens to exercise it. Lives in the
// integration tier because the real half spawns; the fake half rides along for free.
//
// Not a shell test suite — only covers what shellLikeResponder actually implements (see
// FakeExecutor.ts). Adding a new case to the fake should add a case here too.

type Case = {
  name: string;
  program: string;
  args?: string[];
  stdin?: string;
  cwd?: string;
  expect: {
    stdout?: string;
    /** Used instead of `stdout` when exact whitespace isn't part of the contract (e.g. wc -l padding differs by platform). */
    stdoutTrimmed?: string;
    stderr?: string;
    stderrIncludes?: string;
    exitCode?: number | null;
  };
};

const cases: Case[] = [
  { name: 'echo joins args with spaces', program: 'echo', args: ['a', 'b'], expect: { stdout: 'a b\n', exitCode: 0 } },
  { name: 'false exits 1', program: 'false', expect: { exitCode: 1 } },
  { name: 'cat echoes stdin', program: 'cat', stdin: 'hello', expect: { stdout: 'hello', exitCode: 0 } },
  { name: 'grep filters matching lines', program: 'grep', args: ['b'], stdin: 'a\nb\n', expect: { stdout: 'b\n', exitCode: 0 } },
  { name: 'grep exits 1 on no match', program: 'grep', args: ['z'], stdin: 'a\nb\n', expect: { stdout: '', exitCode: 1 } },
  { name: 'wc -l counts lines', program: 'wc', args: ['-l'], stdin: 'a\nb\nc\n', expect: { stdoutTrimmed: '3', exitCode: 0 } },
  { name: "sh -c 'exit N' reports the exit code", program: 'sh', args: ['-c', 'exit 3'], expect: { exitCode: 3 } },
  { name: "sh -c 'echo ... >&2' writes to stderr", program: 'sh', args: ['-c', 'echo e >&2'], expect: { stderr: 'e\n', exitCode: 0 } },
  { name: 'a missing command reports 127 and "Command not found"', program: 'definitely-not-a-real-command-xyzzy-conformance', expect: { exitCode: 127, stderrIncludes: 'Command not found' } },
  { name: 'a missing cwd reports 126 and "Working directory not found"', program: 'echo', args: ['hi'], cwd: '/nonexistent/path/xyz-conformance', expect: { exitCode: 126, stderrIncludes: 'Working directory not found' } },
];

async function run(executor: IExecutor, c: Case): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let stdoutText = '';
  let stderrText = '';
  stdout.on('data', (chunk) => {
    stdoutText += chunk.toString();
  });
  stderr.on('data', (chunk) => {
    stderrText += chunk.toString();
  });

  const status = await executor.run(
    { program: c.program, args: c.args ?? [], cwd: c.cwd ?? process.cwd(), env: process.env },
    { stdin: c.stdin != null ? Readable.from(c.stdin) : undefined, stdout, stderr },
  );

  return { stdout: stdoutText, stderr: stderrText, exitCode: status.exitCode };
}

const executors: [string, IExecutor][] = [
  ['FakeExecutor', new FakeExecutor(shellLikeResponder())],
  ['Executor (real)', new Executor()],
];

describe.each(executors)('%s', (_name, executor) => {
  for (const c of cases) {
    it(c.name, async () => {
      const result = await run(executor, c);

      if (c.expect.stdout != null) {
        expect(result.stdout).toBe(c.expect.stdout);
      }
      if (c.expect.stdoutTrimmed != null) {
        expect(result.stdout.trim()).toBe(c.expect.stdoutTrimmed);
      }
      if (c.expect.stderr != null) {
        expect(result.stderr).toBe(c.expect.stderr);
      }
      if (c.expect.stderrIncludes != null) {
        expect(result.stderr).toContain(c.expect.stderrIncludes);
      }
      if (c.expect.exitCode !== undefined) {
        expect(result.exitCode).toBe(c.expect.exitCode);
      }
    });
  }
});
