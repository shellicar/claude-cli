import { PassThrough, Readable } from 'node:stream';
import { Executor, fromStream, type IExecutor, type PipelineStage } from '@shellicar/exec-core';
import { describe, expect, it } from 'vitest';
import { FakeExecutor, shellLikeResponder } from '../FakeExecutor';

// Pins FakeExecutor's shellLikeResponder to what the real Executor actually does, one table
// case per behaviour the fake models. Runs the same case against both, so a drift (the fake stops
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
  { name: 'printf prints a lone format string verbatim', program: 'printf', args: ['a\nb\n'], expect: { stdout: 'a\nb\n', exitCode: 0 } },
  { name: 'tee echoes stdin', program: 'tee', stdin: 'hello\n', expect: { stdout: 'hello\n', exitCode: 0 } },
  { name: 'node -e writes a literal string', program: 'node', args: ['-e', "process.stdout.write('hi')"], expect: { stdout: 'hi', exitCode: 0 } },
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

  const status = await executor.run({ program: c.program, args: c.args ?? [], cwd: c.cwd ?? process.cwd(), env: process.env }, { stdin: c.stdin != null ? Readable.from(c.stdin) : undefined, stdout, stderr });

  return { stdout: stdoutText, stderr: stderrText, exitCode: status.exitCode };
}

const executors: [string, IExecutor][] = [
  ['FakeExecutor', new FakeExecutor(shellLikeResponder())],
  ['Executor (real)', new Executor()],
];

type Outcome = { stdout: string; stderr: string; exitCode: number | null };

function expectCase(result: Outcome, c: Case): void {
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
}

describe.each(executors)('%s', (_name, executor) => {
  for (const c of cases) {
    it(c.name, async () => {
      expectCase(await run(executor, c), c);
    });
  }
});

// The same table again, driven as a one-stage pipeline. A single command is the commonest
// thing ExecV3 runs, and it reaches the executor through runPipeline, not run — so without
// these, every behaviour above is pinned on a route the tool does not take.

async function runAsSingleStage(executor: IExecutor, c: Case): Promise<Outcome> {
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

  const [status] = await Promise.all(executor.runPipeline([{ cmd: { program: c.program, args: c.args ?? [], cwd: c.cwd ?? process.cwd(), env: process.env }, stdout, stderr }], { stdin: c.stdin != null ? Readable.from(c.stdin) : undefined }));

  return { stdout: stdoutText, stderr: stderrText, exitCode: status.exitCode };
}

describe.each(executors)('%s as a one-stage pipeline', (_name, executor) => {
  for (const c of cases) {
    it(c.name, async () => {
      expectCase(await runAsSingleStage(executor, c), c);
    });
  }
});

// The same pinning for pipelines. FakeExecutor cannot join processes, so it carries each
// stage's output forward as a string instead; these cases are what hold that stand-in to what
// the real Executor does, and without them every fake-backed pipe test rests on nothing.

type PipeCase = {
  name: string;
  stages: { program: string; args?: string[] }[];
  expect: {
    terminalStdout?: string;
    /** Used instead of `terminalStdout` when exact whitespace isn't part of the contract. */
    terminalStdoutTrimmed?: string;
    exitCodes: (number | null)[];
  };
};

const pipeCases: PipeCase[] = [
  { name: 'carries stdout into the next stage', stages: [{ program: 'echo', args: ['a', 'b'] }, { program: 'cat' }], expect: { terminalStdout: 'a b\n', exitCodes: [0, 0] } },
  {
    name: 'carries stdout through three stages',
    stages: [
      { program: 'printf', args: ['a\nb\nc\n'] },
      { program: 'grep', args: ['b'] },
      { program: 'wc', args: ['-l'] },
    ],
    expect: { terminalStdoutTrimmed: '1', exitCodes: [0, 0, 0] },
  },
  { name: 'reports each stage its own exit code', stages: [{ program: 'false' }, { program: 'cat' }], expect: { terminalStdout: '', exitCodes: [1, 0] } },
];

async function runPipe(executor: IExecutor, c: PipeCase): Promise<{ terminalStdout: string; exitCodes: (number | null)[] }> {
  const terminal = new PassThrough();
  let terminalStdout = '';
  terminal.on('data', (chunk) => {
    terminalStdout += chunk.toString();
  });

  const stages: PipelineStage[] = c.stages.map((stage, i) => ({
    cmd: { program: stage.program, args: stage.args ?? [], cwd: process.cwd(), env: process.env },
    stdout: i === c.stages.length - 1 ? terminal : undefined,
    stderr: new PassThrough().resume(),
  }));

  const statuses = await Promise.all(executor.runPipeline(stages));
  return { terminalStdout, exitCodes: statuses.map((s) => s.exitCode) };
}

describe.each(executors)('%s pipelines', (_name, executor) => {
  for (const c of pipeCases) {
    it(c.name, async () => {
      const result = await runPipe(executor, c);

      if (c.expect.terminalStdout != null) {
        expect(result.terminalStdout).toBe(c.expect.terminalStdout);
      }
      if (c.expect.terminalStdoutTrimmed != null) {
        expect(result.terminalStdout.trim()).toBe(c.expect.terminalStdoutTrimmed);
      }
    });

    it(`${c.name} — exit codes`, async () => {
      const result = await runPipe(executor, c);
      expect(result.exitCodes).toEqual(c.expect.exitCodes);
    });
  }
});

// Merging is the axis the pipe cases above leave untested, and it is the one where the fake
// and the real executor can drift apart without anything noticing: the fake ends every sink a
// stage was given, so a real executor that leaves one open still looks correct from any
// fake-backed test. A caller drains these sinks to strings, so an unended one is not a lost
// message but a result that never arrives.

const DRAIN_BOUND_MS = 2000;

// Drains each stage's stderr to a string exactly as ExecV3 does, so "the sink was ended" and
// "the caller's read completes" are the same event. An unended sink leaves that read pending
// forever, so the bound is what turns a hang into a value the assertion can compare.
async function drainsEveryStderr(executor: IExecutor, stageCount: number): Promise<boolean> {
  const cmd = { program: 'echo', args: ['hi'], cwd: process.cwd(), env: process.env };
  const stages: PipelineStage[] = Array.from({ length: stageCount }, (_, i) => ({
    cmd: i === 0 ? cmd : { program: 'cat', args: [], cwd: cmd.cwd, env: cmd.env },
    stdout: i === stageCount - 1 ? new PassThrough().resume() : undefined,
    stderr: new PassThrough(),
    mergeStderr: true,
  }));

  const runs = executor.runPipeline(stages);
  const drains = stages.map((stage) => fromStream(stage.stderr as PassThrough));
  const done = Promise.all([...runs, ...drains]).then(() => true);
  const bound = new Promise<boolean>((resolve) => {
    setTimeout(() => resolve(false), DRAIN_BOUND_MS);
  });

  return Promise.race([done, bound]);
}

describe.each(executors)('%s merged stages', (_name, executor) => {
  it('ends the stderr sink of a single merged stage', async () => {
    const expected = true;
    const actual = await drainsEveryStderr(executor, 1);
    expect(actual).toBe(expected);
  });

  it('ends the stderr sink of every stage in a merged pipeline', async () => {
    const expected = true;
    const actual = await drainsEveryStderr(executor, 2);
    expect(actual).toBe(expected);
  });
});
