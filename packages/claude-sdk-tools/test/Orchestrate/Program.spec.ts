import type { CommandSpec, ExitStatus, IExecutor, SpawnOpts } from '@shellicar/exec-core';
import { PipeConsumerGone } from '@shellicar/exec-core';
import type { Stream } from '@shellicar/orchestrate-core';
import { describe, expect, it } from 'vitest';
import { createProgramToolV2, ProgramToolV2Model } from '../../src/Orchestrate/tools/Program.js';
import { FakeExecutor, shellLikeResponder } from '../FakeExecutor.js';
import { fakeEnvProvider } from '../fakeEnvProvider.js';
import { MemoryFileSystem } from '../MemoryFileSystem.js';

async function drain(stream: Stream<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const value of stream) {
    out.push(value);
  }
  return out;
}

describe('Program tool — validation', () => {
  it('rejects an empty program — without this, an empty program silently "succeeds" with success: false, not a clear validation error', () => {
    const expected = false;
    const actual = ProgramToolV2Model.safeParse({ program: '', cwd: '/tmp' }).success;
    expect(actual).toBe(expected);
  });

  it('cwd is optional at the schema level — a real shell inherits the parent cwd when none is given, and so does Program', () => {
    const expected = true;
    const actual = ProgramToolV2Model.safeParse({ program: 'echo' }).success;
    expect(actual).toBe(expected);
  });
});

describe('Program tool — resolveDefaults', () => {
  it('leaves cwd untouched when it was actually supplied', () => {
    const tool = createProgramToolV2(new FakeExecutor(() => ({ exitCode: 0 })), new MemoryFileSystem({}, '/home/user', '/memory-cwd'), fakeEnvProvider());

    const expected = '/explicit';
    const actual = tool.resolveDefaults?.({ program: 'echo', cwd: '/explicit' })?.cwd;
    expect(actual).toBe(expected);
  });

  it('defaults cwd to the injected IFileSystem\u2019s own cwd() when omitted — never the real process.cwd()', () => {
    const fs = new MemoryFileSystem({}, '/home/user', '/memory-cwd');
    const tool = createProgramToolV2(new FakeExecutor(() => ({ exitCode: 0 })), fs, fakeEnvProvider());

    const expected = '/memory-cwd';
    const actual = tool.resolveDefaults?.({ program: 'echo' })?.cwd;
    expect(actual).toBe(expected);
  });
});

describe('Program tool — stdout/stderr separation', () => {
  it('yields stdout lines on the stream', async () => {
    const executor = new FakeExecutor(() => ({ stdout: 'out-line\n', exitCode: 0 }));
    const tool = createProgramToolV2(executor, new MemoryFileSystem(), fakeEnvProvider());

    const { stdout } = tool.run({ program: 'sh', cwd: '/tmp' }, undefined, []);
    const actual = await drain(stdout);

    const expected = ['out-line'];
    expect(actual).toEqual(expected);
  });

  it('captures stderr separately from stdout by default', async () => {
    const executor = new FakeExecutor(() => ({ stdout: 'out-line\n', stderr: 'err-line\n', exitCode: 0 }));
    const tool = createProgramToolV2(executor, new MemoryFileSystem(), fakeEnvProvider());
    const stderr: string[] = [];

    const { stdout } = tool.run({ program: 'sh', cwd: '/tmp' }, undefined, stderr);
    await drain(stdout);

    const expected = ['err-line'];
    const actual = stderr;
    expect(actual).toEqual(expected);
  });

  it('folds stderr into stdout when mergeStderr is set', async () => {
    const executor = new FakeExecutor(() => ({ stdout: 'out-line\n', stderr: 'err-line\n', exitCode: 0 }));
    const tool = createProgramToolV2(executor, new MemoryFileSystem(), fakeEnvProvider());
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
    const tool = createProgramToolV2(executor, new MemoryFileSystem(), fakeEnvProvider());

    const { stdout, success } = tool.run({ program: 'sh', cwd: '/tmp' }, undefined, []);
    await drain(stdout);

    const expected = true;
    const actual = success();
    expect(actual).toBe(expected);
  });

  it('reports failure when the exit code is non-zero', async () => {
    const executor = new FakeExecutor(() => ({ exitCode: 1 }));
    const tool = createProgramToolV2(executor, new MemoryFileSystem(), fakeEnvProvider());

    const { stdout, success } = tool.run({ program: 'sh', cwd: '/tmp' }, undefined, []);
    await drain(stdout);

    const expected = false;
    const actual = success();
    expect(actual).toBe(expected);
  });
});

describe('Program tool — command wiring', () => {
  it('passes program, args, and cwd to the executor', async () => {
    const executor = new FakeExecutor(() => ({ exitCode: 0 }));
    const tool = createProgramToolV2(executor, new MemoryFileSystem(), fakeEnvProvider());

    const { stdout } = tool.run({ program: 'echo', args: ['hi'], cwd: '/somewhere' }, undefined, []);
    await drain(stdout);

    const expected = { program: 'echo', args: ['hi'], cwd: '/somewhere' };
    const { env: _env, ...actual } = executor.calls[0];
    expect(actual).toEqual(expected);
  });

  // The env is the provider's, not the raw process environment — the same stripping an ExecV3 call
  // gets. The call's own `env` is merged in by the provider, so it still reaches the process.
  it("builds the process env through the provider, carrying the call's own env into it", async () => {
    const executor = new FakeExecutor(() => ({ exitCode: 0 }));
    const tool = createProgramToolV2(executor, new MemoryFileSystem(), fakeEnvProvider({ FROM_PROVIDER: 'yes' }));

    const { stdout } = tool.run({ program: 'echo', cwd: '/somewhere', env: { FOO: 'bar' } }, undefined, []);
    await drain(stdout);

    const expected = { FROM_PROVIDER: 'yes', FOO: 'bar' };
    const env = executor.calls[0]?.env ?? {};
    const actual = { FROM_PROVIDER: env.FROM_PROVIDER, FOO: env.FOO };
    expect(actual).toEqual(expected);
  });

  // No shell runs here, so an unexpanded `$TMUX_PANE` would reach the program as a literal.
  it('expands a $VAR in args from the environment the call runs under', async () => {
    const executor = new FakeExecutor(() => ({ exitCode: 0 }));
    const tool = createProgramToolV2(executor, new MemoryFileSystem(), fakeEnvProvider({ TMUX_PANE: '%42' }));

    const { stdout } = tool.run({ program: 'tmux', args: ['display', '-t', '$TMUX_PANE'], cwd: '/somewhere' }, undefined, []);
    await drain(stdout);

    const expected = ['display', '-t', '%42'];
    const actual = executor.calls[0]?.args;
    expect(actual).toEqual(expected);
  });

  it('leaves an unknown name as written rather than blanking it', async () => {
    const executor = new FakeExecutor(() => ({ exitCode: 0 }));
    const tool = createProgramToolV2(executor, new MemoryFileSystem(), fakeEnvProvider());

    const { stdout } = tool.run({ program: 'echo', args: ['$NOT_SET_ANYWHERE_AT_ALL'], cwd: '/somewhere' }, undefined, []);
    await drain(stdout);

    const expected = ['$NOT_SET_ANYWHERE_AT_ALL'];
    const actual = executor.calls[0]?.args;
    expect(actual).toEqual(expected);
  });

  it('pipes an upstream string iterable into the process stdin', async () => {
    let capturedStdin = '';
    const executor = new FakeExecutor((_cmd, stdin) => {
      capturedStdin = stdin;
      return { exitCode: 0 };
    });
    const tool = createProgramToolV2(executor, new MemoryFileSystem(), fakeEnvProvider());

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
    const tool = createProgramToolV2(executor, new MemoryFileSystem(), fakeEnvProvider());

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
    const tool = createProgramToolV2(executor, new MemoryFileSystem(), fakeEnvProvider());

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

// What used to be here: a producer of more than 10,000 lines was killed outright. That limit
// existed because output accumulated without bound, and it doesn't now — a producer that outruns
// its reader waits, and one whose reader has gone is killed when the stream closes. A large output
// nobody has stopped reading is a legitimate thing to ask for.
describe('Program tool — a large output nothing has stopped', () => {
  it('yields every line of it', async () => {
    const lines = Array.from({ length: 20_000 }, (_, index) => `line${index}`);
    const executor = new FakeExecutor(() => ({ stdout: `${lines.join('\n')}\n`, exitCode: 0 }));
    const tool = createProgramToolV2(executor, new MemoryFileSystem(), fakeEnvProvider());

    const { stdout } = tool.run({ program: 'seq', cwd: '/tmp' }, undefined, []);

    const expected = lines.length;
    const actual = (await drain(stdout)).length;
    expect(actual).toBe(expected);
  });
});

// The same real FakeResponder ExecV3's own scenario tests use for "not found" / "bad cwd" /
// ANSI — reused here to prove genuinely equivalent behaviour, not a re-invented fixture.
describe('Program tool — parity with ExecV3 scenarios', () => {
  const executor = new FakeExecutor(shellLikeResponder());
  const tool = createProgramToolV2(executor, new MemoryFileSystem(), fakeEnvProvider());

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
    const tool = createProgramToolV2(executor, fs, fakeEnvProvider());

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
    const tool = createProgramToolV2(executor, fs, fakeEnvProvider());
    const stderr: string[] = [];

    const { stdout } = tool.run({ program: 'sh', cwd: '/cwd/dir', redirect: { stderr: 'err.log' } }, undefined, stderr);
    await drain(stdout);

    const expected = 'oops\n';
    const actual = await fs.readFile('/cwd/dir/err.log');
    expect(stderr).toEqual([]);
    expect(actual).toBe(expected);
  });
});

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

describe('Program tool — timeout', () => {
  it('kills the process after the given number of milliseconds', async () => {
    const tool = createProgramToolV2(neverSettlingExecutor(), new MemoryFileSystem(), fakeEnvProvider());

    const { stdout, success } = tool.run({ program: 'sleep', args: ['5'], cwd: '/tmp', timeout: 20 }, undefined, []);
    await drain(stdout);

    const expected = false;
    const actual = success();
    expect(actual).toBe(expected);
  });
});

describe('Program tool — external cancellation', () => {
  it("kills the process when the caller's own signal is aborted mid-run", async () => {
    const executor = neverSettlingExecutor();
    const tool = createProgramToolV2(executor, new MemoryFileSystem(), fakeEnvProvider());
    const controller = new AbortController();

    const { stdout, success } = tool.run({ program: 'sleep', args: ['5'], cwd: '/tmp' }, undefined, [], controller.signal);
    controller.abort();
    await drain(stdout);

    const expected = false;
    const actual = success();
    expect(actual).toBe(expected);
  });

  it("does not touch the process when the caller's signal is never aborted", async () => {
    const executor = new FakeExecutor(() => ({ exitCode: 0 }));
    const tool = createProgramToolV2(executor, new MemoryFileSystem(), fakeEnvProvider());
    const controller = new AbortController();

    const { stdout, success } = tool.run({ program: 'sh', cwd: '/tmp' }, undefined, [], controller.signal);
    await drain(stdout);

    const expected = true;
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
    const tool = createProgramToolV2(executor, new MemoryFileSystem(), fakeEnvProvider());

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
