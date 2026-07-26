import type { CommandSpec, ExitStatus, IExecutor, SpawnOpts } from '@shellicar/exec-core';
import { PipeConsumerGone } from '@shellicar/exec-core';
import type { Stream } from '@shellicar/orchestrate-core';
import { describe, expect, it } from 'vitest';
import { createProgramToolV2, ProgramFailsafeTerminated } from '../../src/Orchestrate/tools/Program.js';
import { FakeExecutor, shellLikeResponder } from '../FakeExecutor.js';
import { MemoryFileSystem } from '../MemoryFileSystem.js';

async function drain(stream: Stream<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const value of stream) {
    out.push(value);
  }
  return out;
}

describe('Program tool — stdout/stderr separation', () => {
  it('yields stdout lines on the stream', async () => {
    const executor = new FakeExecutor(() => ({ stdout: 'out-line\n', exitCode: 0 }));
    const tool = createProgramToolV2(executor, new MemoryFileSystem());

    const { stdout } = tool.run({ program: 'sh', cwd: '/tmp' }, undefined, []);
    const actual = await drain(stdout);

    const expected = ['out-line'];
    expect(actual).toEqual(expected);
  });

  it('captures stderr separately from stdout by default', async () => {
    const executor = new FakeExecutor(() => ({ stdout: 'out-line\n', stderr: 'err-line\n', exitCode: 0 }));
    const tool = createProgramToolV2(executor, new MemoryFileSystem());
    const stderr: string[] = [];

    const { stdout } = tool.run({ program: 'sh', cwd: '/tmp' }, undefined, stderr);
    await drain(stdout);

    const expected = ['err-line'];
    const actual = stderr;
    expect(actual).toEqual(expected);
  });

  it('folds stderr into stdout when mergeStderr is set', async () => {
    const executor = new FakeExecutor(() => ({ stdout: 'out-line\n', stderr: 'err-line\n', exitCode: 0 }));
    const tool = createProgramToolV2(executor, new MemoryFileSystem());
    const stderr: string[] = [];

    const { stdout } = tool.run({ program: 'sh', cwd: '/tmp', mergeStderr: true }, undefined, stderr);
    await drain(stdout);

    const expected: string[] = [];
    const actual = stderr;
    expect(actual).toEqual(expected);
  });
});

describe('Program tool — success', () => {
  it('reports success when the exit code is 0', async () => {
    const executor = new FakeExecutor(() => ({ exitCode: 0 }));
    const tool = createProgramToolV2(executor, new MemoryFileSystem());

    const { stdout, success } = tool.run({ program: 'sh', cwd: '/tmp' }, undefined, []);
    await drain(stdout);

    const expected = true;
    const actual = success();
    expect(actual).toBe(expected);
  });

  it('reports failure when the exit code is non-zero', async () => {
    const executor = new FakeExecutor(() => ({ exitCode: 1 }));
    const tool = createProgramToolV2(executor, new MemoryFileSystem());

    const { stdout, success } = tool.run({ program: 'sh', cwd: '/tmp' }, undefined, []);
    await drain(stdout);

    const expected = false;
    const actual = success();
    expect(actual).toBe(expected);
  });
});

describe('Program tool — command wiring', () => {
  it('passes program, args, cwd, and env to the executor', async () => {
    const executor = new FakeExecutor(() => ({ exitCode: 0 }));
    const tool = createProgramToolV2(executor, new MemoryFileSystem());

    const { stdout } = tool.run({ program: 'echo', args: ['hi'], cwd: '/somewhere', env: { FOO: 'bar' } }, undefined, []);
    await drain(stdout);

    const expected = { program: 'echo', args: ['hi'], cwd: '/somewhere', env: { FOO: 'bar' } };
    const actual = executor.calls[0];
    expect(actual).toEqual(expected);
  });

  it('pipes an upstream string iterable into the process stdin', async () => {
    let capturedStdin = '';
    const executor = new FakeExecutor((_cmd, stdin) => {
      capturedStdin = stdin;
      return { exitCode: 0 };
    });
    const tool = createProgramToolV2(executor, new MemoryFileSystem());

    async function* upstream(): Stream<string> {
      yield 'piped-value';
    }

    const { stdout } = tool.run({ program: 'cat', cwd: '/tmp' }, upstream(), []);
    await drain(stdout);

    const expected = 'piped-value\n';
    const actual = capturedStdin;
    expect(actual).toBe(expected);
  });

  it('feeds a literal stdin string into the process when nothing is piped in', async () => {
    let capturedStdin = '';
    const executor = new FakeExecutor((_cmd, stdin) => {
      capturedStdin = stdin;
      return { exitCode: 0 };
    });
    const tool = createProgramToolV2(executor, new MemoryFileSystem());

    const { stdout } = tool.run({ program: 'cat', cwd: '/tmp', stdin: 'hello' }, undefined, []);
    await drain(stdout);

    const expected = 'hello';
    const actual = capturedStdin;
    expect(actual).toBe(expected);
  });

  it('prefers a piped upstream over a literal stdin value when both are present', async () => {
    let capturedStdin = '';
    const executor = new FakeExecutor((_cmd, stdin) => {
      capturedStdin = stdin;
      return { exitCode: 0 };
    });
    const tool = createProgramToolV2(executor, new MemoryFileSystem());

    async function* upstream(): Stream<string> {
      yield 'from-upstream';
    }

    const { stdout } = tool.run({ program: 'cat', cwd: '/tmp', stdin: 'from-literal' }, upstream(), []);
    await drain(stdout);

    const expected = 'from-upstream\n';
    const actual = capturedStdin;
    expect(actual).toBe(expected);
  });
});

describe('Program tool — failsafe cap', () => {
  it('hard-terminates a producer that exceeds the line cap', async () => {
    const hugeOutput = `${Array.from({ length: 10_001 }, (_, i) => `line${i}`).join('\n')}\n`;
    const executor = new FakeExecutor(() => ({ stdout: hugeOutput, exitCode: 0 }));
    const tool = createProgramToolV2(executor, new MemoryFileSystem());

    const { stdout } = tool.run({ program: 'yes', cwd: '/tmp' }, undefined, []);

    await expect(drain(stdout)).rejects.toThrow(ProgramFailsafeTerminated);
  });
});

// The same real FakeResponder ExecV3's own scenario tests use for "not found" / "bad cwd" /
// ANSI — reused here to prove genuinely equivalent behaviour, not a re-invented fixture.
describe('Program tool — parity with ExecV3 scenarios', () => {
  const executor = new FakeExecutor(shellLikeResponder());
  const tool = createProgramToolV2(executor, new MemoryFileSystem());

  it('a missing program exits 127 with "Command not found" on stderr', async () => {
    const stderr: string[] = [];
    const { stdout, success } = tool.run({ program: 'definitely-not-a-real-command-xyzzy', cwd: '/tmp' }, undefined, stderr);
    await drain(stdout);

    expect(success()).toBe(false);
    expect(stderr[0]).toContain('Command not found');
  });

  it('a missing cwd exits 126 with "Working directory not found" on stderr', async () => {
    const stderr: string[] = [];
    const { stdout, success } = tool.run({ program: 'echo', args: ['hello'], cwd: '/nonexistent/path/xyz123abc' }, undefined, stderr);
    await drain(stdout);

    expect(success()).toBe(false);
    expect(stderr[0]).toContain('Working directory not found');
  });

  it('strips ANSI escape codes from stdout by default', async () => {
    const { stdout } = tool.run({ program: 'node', args: ['-e', "process.stdout.write('\\x1b[31mred\\x1b[0m')"], cwd: '/tmp' }, undefined, []);
    const actual = await drain(stdout);

    const expected = ['red'];
    expect(actual).toEqual(expected);
  });

  it('leaves ANSI escape codes in place when stripAnsi is set to false', async () => {
    const { stdout } = tool.run({ program: 'node', args: ['-e', "process.stdout.write('\\x1b[31mred\\x1b[0m')"], cwd: '/tmp', stripAnsi: false }, undefined, []);
    const actual = await drain(stdout);

    expect(actual[0]).toContain('\x1b[31m');
  });
});

describe('Program tool — redirect', () => {
  it('writes stdout to a file instead of yielding it, resolved against the call\u2019s own cwd', async () => {
    const fs = new MemoryFileSystem();
    const executor = new FakeExecutor(() => ({ stdout: 'hi\n', exitCode: 0 }));
    const tool = createProgramToolV2(executor, fs);

    const { stdout } = tool.run({ program: 'echo', args: ['hi'], cwd: '/cwd/dir', redirect: { stdout: 'out.log' } }, undefined, []);
    const yielded = await drain(stdout);

    const expected = 'hi\n';
    const actual = await fs.readFile('/cwd/dir/out.log');
    expect(yielded).toEqual([]);
    expect(actual).toBe(expected);
  });

  it('writes stderr to a file instead of capturing it', async () => {
    const fs = new MemoryFileSystem();
    const executor = new FakeExecutor(() => ({ stderr: 'oops\n', exitCode: 0 }));
    const tool = createProgramToolV2(executor, fs);
    const stderr: string[] = [];

    const { stdout } = tool.run({ program: 'sh', cwd: '/cwd/dir', redirect: { stderr: 'err.log' } }, undefined, stderr);
    await drain(stdout);

    const expected = 'oops\n';
    const actual = await fs.readFile('/cwd/dir/err.log');
    expect(stderr).toEqual([]);
    expect(actual).toBe(expected);
  });
});

describe('Program tool — timeout', () => {
  function neverSettlingExecutor(): IExecutor {
    return {
      async run(_cmd: CommandSpec, opts: SpawnOpts = {}): Promise<ExitStatus> {
        return new Promise<ExitStatus>((resolvePromise) => {
          opts.signal?.addEventListener('abort', () => {
            resolvePromise({ exitCode: null, signal: 'SIGTERM' });
          });
        });
      },
    };
  }

  it('kills the process after the given number of milliseconds', async () => {
    const tool = createProgramToolV2(neverSettlingExecutor(), new MemoryFileSystem());

    const { stdout, success } = tool.run({ program: 'sleep', args: ['5'], cwd: '/tmp', timeout: 20 }, undefined, []);
    await drain(stdout);

    const expected = false;
    const actual = success();
    expect(actual).toBe(expected);
  });
});

describe('Program tool — pipe-consumer-gone kill', () => {
  it('aborts the real process with PipeConsumerGone when the downstream consumer stops pulling early, even mid-wait with nothing queued', async () => {
    let abortReason: unknown;
    const executor: IExecutor = {
      async run(_cmd: CommandSpec, opts: SpawnOpts = {}): Promise<ExitStatus> {
        return new Promise<ExitStatus>((resolvePromise) => {
          opts.signal?.addEventListener('abort', () => {
            abortReason = opts.signal?.reason;
            resolvePromise({ exitCode: null, signal: 'SIGPIPE' });
          });
        });
      },
    };
    const tool = createProgramToolV2(executor, new MemoryFileSystem());

    const { stdout } = tool.run({ program: 'yes', cwd: '/tmp' }, undefined, []);
    // Start pulling so drain() is actually suspended inside the wait, with nothing queued yet —
    // exactly the state that used to deadlock a bare generator's return().
    void stdout.next();
    await new Promise((r) => setImmediate(r));
    await stdout.return(undefined);

    const expected = PipeConsumerGone;
    const actual = abortReason;
    expect(actual).toBe(expected);
  });
});
