import { ToolCancelledError } from '@shellicar/claude-sdk';
import type { CommandSpec, ExitStatus, IExecutor, SpawnOpts } from '@shellicar/exec-core';
import { describe, expect, it } from 'vitest';
import { createExec } from '../src/Exec/Exec';
import { Exec } from '../src/entry/Exec';
import { nodeFs } from '../src/fs/nodeFs';
import { call } from './helpers';

type StubExecutor = {
  executor: IExecutor;
  /** The greatest number of runs that were in flight at the same moment. */
  maxInFlight: () => number;
};

// Proves concurrency by observation rather than wall-clock timing: every run registers
// at a shared barrier and blocks until all `expected` runs have started. Under concurrent
// execution every run reaches the barrier and it releases, so the peak in-flight count
// equals `expected`. Under sequential execution the first run would block forever waiting
// for a sibling that never starts; the per-run timeout turns that regression into an
// explicit failure instead of a hang.
function createInterleavingExecutor(expected: number): StubExecutor {
  let started = 0;
  let inFlight = 0;
  let peak = 0;
  let releaseBarrier!: () => void;
  const barrier = new Promise<void>((resolve) => {
    releaseBarrier = resolve;
  });

  const run = async (cmd: CommandSpec, opts?: SpawnOpts): Promise<ExitStatus> => {
    started++;
    inFlight++;
    peak = Math.max(peak, inFlight);
    if (started === expected) {
      releaseBarrier();
    }

    let deadlock: ReturnType<typeof setTimeout> | undefined;
    const guard = new Promise<never>((_, reject) => {
      deadlock = setTimeout(() => reject(new Error('Exec ran steps sequentially: a step never started')), 2000);
    });
    try {
      await Promise.race([barrier, guard]);
    } finally {
      clearTimeout(deadlock);
    }

    opts?.stdout?.end(cmd.program);
    opts?.stderr?.end();
    inFlight--;
    return { exitCode: 0, signal: null };
  };

  return { executor: { run }, maxInFlight: () => peak };
}

describe('Exec \u2014 basic execution', () => {
  it('runs a command and captures stdout', async () => {
    const result = await call(Exec, {
      intent: 'echo hello',
      steps: [{ commands: [{ program: 'echo', args: ['hello'] }] }],
    });
    expect(result.success).toBe(true);
    expect(result.results[0].stdout).toBe('hello');
  });

  it('trims trailing whitespace from stdout', async () => {
    // echo appends a newline; the handler calls trimEnd()
    const result = await call(Exec, {
      intent: 'echo with trailing newline',
      steps: [{ commands: [{ program: 'echo', args: ['hello'] }] }],
    });
    expect(result.results[0].stdout).not.toMatch(/\n$/);
  });

  it('returns exitCode 0 on success', async () => {
    const result = await call(Exec, {
      intent: 'true',
      steps: [{ commands: [{ program: 'sh', args: ['-c', 'exit 0'] }] }],
    });
    expect(result.results[0].exitCode).toBe(0);
  });

  it('captures a non-zero exit code', async () => {
    const result = await call(Exec, {
      intent: 'exit 42',
      steps: [{ commands: [{ program: 'sh', args: ['-c', 'exit 42'] }] }],
    });
    expect(result.success).toBe(false);
    expect(result.results[0].exitCode).toBe(42);
  });

  it('captures stderr separately from stdout', async () => {
    const result = await call(Exec, {
      intent: 'write to stderr',
      steps: [{ commands: [{ program: 'sh', args: ['-c', 'echo error >&2'] }] }],
    });
    expect(result.results[0].stderr).toBe('error');
    expect(result.results[0].stdout).toBe('');
  });
});

describe('Exec \u2014 blocked commands', () => {
  it('blocks rm', async () => {
    const result = await call(Exec, {
      intent: 'try rm',
      steps: [{ commands: [{ program: 'rm', args: ['-rf', '/tmp/safe'] }] }],
    });
    expect(result.success).toBe(false);
    expect(result.results[0].stderr).toContain('BLOCKED');
  });

  it('blocks sudo', async () => {
    const result = await call(Exec, {
      intent: 'try sudo',
      steps: [{ commands: [{ program: 'sudo', args: ['ls'] }] }],
    });
    expect(result.success).toBe(false);
    expect(result.results[0].stderr).toContain('BLOCKED');
  });

  it('blocks xargs', async () => {
    const result = await call(Exec, {
      intent: 'try xargs',
      steps: [{ commands: [{ program: 'xargs', args: ['echo'] }] }],
    });
    expect(result.success).toBe(false);
    expect(result.results[0].stderr).toContain('BLOCKED');
  });

  it('includes the rule name in the error message', async () => {
    const result = await call(Exec, {
      intent: 'try sudo',
      steps: [{ commands: [{ program: 'sudo', args: ['ls'] }] }],
    });
    expect(result.results[0].stderr).toContain('no-sudo');
  });

  it('blocks all commands in a step — not just the first', async () => {
    const result = await call(Exec, {
      intent: 'rm and sudo in same step',
      steps: [
        {
          commands: [
            { program: 'rm', args: ['/tmp/x'] },
            { program: 'sudo', args: ['ls'] },
          ],
        },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.results[0].stderr).toContain('no-destructive-commands');
    expect(result.results[0].stderr).toContain('no-sudo');
  });
});

describe('Exec \u2014 chaining', () => {
  it('returns one result per completed step', async () => {
    const result = await call(Exec, {
      intent: 'two steps',
      steps: [{ commands: [{ program: 'echo', args: ['a'] }] }, { commands: [{ program: 'echo', args: ['b'] }] }],
    });
    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].stdout).toBe('a');
    expect(result.results[1].stdout).toBe('b');
  });

  it('stops at the first failure with bail_on_error (default)', async () => {
    const result = await call(Exec, {
      intent: 'fail then echo',
      steps: [{ commands: [{ program: 'sh', args: ['-c', 'exit 1'] }] }, { commands: [{ program: 'echo', args: ['should not run'] }] }],
    });
    expect(result.success).toBe(false);
    expect(result.results).toHaveLength(1);
  });

  it('runs all steps with sequential chaining even after a failure', async () => {
    const result = await call(Exec, {
      intent: 'sequential despite failure',
      chaining: 'sequential',
      steps: [{ commands: [{ program: 'sh', args: ['-c', 'exit 1'] }] }, { commands: [{ program: 'echo', args: ['still runs'] }] }],
    });
    expect(result.results).toHaveLength(2);
    expect(result.results[1].stdout).toBe('still runs');
  });

  it('reports overall success: false when any step fails', async () => {
    const result = await call(Exec, {
      intent: 'mixed results',
      chaining: 'sequential',
      steps: [{ commands: [{ program: 'echo', args: ['ok'] }] }, { commands: [{ program: 'sh', args: ['-c', 'exit 1'] }] }],
    });
    expect(result.success).toBe(false);
  });
});

describe('Exec \u2014 pipeline', () => {
  it('pipes stdout of the first command into stdin of the second', async () => {
    const result = await call(Exec, {
      intent: 'echo piped to grep',
      steps: [
        {
          commands: [
            { program: 'echo', args: ['hello'] },
            { program: 'grep', args: ['hello'] },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.results[0].stdout).toBe('hello');
  });

  it('returns an error when a non-final pipeline command is not found', async () => {
    const result = await call(Exec, {
      intent: 'bad first pipeline command',
      steps: [{ commands: [{ program: 'definitely-not-a-real-command-xyz' }, { program: 'cat' }] }],
    });
    expect(result.success).toBe(false);
    expect(result.results[0].stderr).toContain('Command not found');
  });
});

describe('Exec — redirect', () => {
  it('does not capture redirected stdout in returned results', async () => {
    const result = await call(Exec, {
      intent: 'redirect stdout',
      steps: [{ commands: [{ program: 'echo', args: ['hello'], redirect: { path: '/dev/null', stream: 'stdout' } }] }],
    });
    expect(result.success).toBe(true);
    expect(result.results[0].stdout).toBe('');
  });

  it('does not capture redirected stderr in returned results', async () => {
    const result = await call(Exec, {
      intent: 'redirect stderr',
      steps: [{ commands: [{ program: 'sh', args: ['-c', 'echo error >&2'], redirect: { path: '/dev/null', stream: 'stderr' } }] }],
    });
    expect(result.success).toBe(true);
    expect(result.results[0].stderr).toBe('');
  });
});

describe('Exec \u2014 stripAnsi', () => {
  it('strips ANSI codes from stdout by default', async () => {
    const result = await call(Exec, {
      intent: 'ansi output',
      steps: [{ commands: [{ program: 'node', args: ['-e', "process.stdout.write('\\x1b[31mred\\x1b[0m')"] }] }],
    });
    expect(result.results[0].stdout).toBe('red');
  });

  it('preserves ANSI codes when stripAnsi is false', async () => {
    const result = await call(Exec, {
      intent: 'ansi output preserved',
      stripAnsi: false,
      steps: [{ commands: [{ program: 'node', args: ['-e', "process.stdout.write('\\x1b[31mred\\x1b[0m')"] }] }],
    });
    expect(result.results[0].stdout).toContain('\x1b[');
  });
});

describe('Exec — command features', () => {
  it('respects cwd per command', async () => {
    const result = await call(Exec, {
      intent: 'cwd test',
      steps: [{ commands: [{ program: 'node', args: ['-e', 'process.stdout.write(process.cwd())'], cwd: '/' }] }],
    });
    expect(result.success).toBe(true);
    expect(result.results[0].stdout).toBe('/');
  });

  it('merges custom env vars with the process environment', async () => {
    const result = await call(Exec, {
      intent: 'env test',
      steps: [{ commands: [{ program: 'node', args: ['-e', 'process.stdout.write(process.env.EXEC_TEST_VAR ?? "missing")'], env: { EXEC_TEST_VAR: 'hello' } }] }],
    });
    expect(result.success).toBe(true);
    expect(result.results[0].stdout).toBe('hello');
  });

  it('pipes stdin content to the command', async () => {
    const result = await call(Exec, {
      intent: 'stdin test',
      steps: [{ commands: [{ program: 'cat', stdin: 'hello world' }] }],
    });
    expect(result.success).toBe(true);
    expect(result.results[0].stdout).toBe('hello world');
  });

  it('merge_stderr routes stderr output into stdout', async () => {
    const result = await call(Exec, {
      intent: 'merge_stderr test',
      steps: [{ commands: [{ program: 'sh', args: ['-c', 'echo from_stderr >&2'], merge_stderr: true }] }],
    });
    expect(result.success).toBe(true);
    expect(result.results[0].stdout).toBe('from_stderr');
    expect(result.results[0].stderr).toBe('');
  });
});

describe('Exec — error handling', () => {
  it('returns exitCode 127 and an error message when the command is not found', async () => {
    const result = await call(Exec, {
      intent: 'unknown command',
      steps: [{ commands: [{ program: 'definitely-not-a-real-command-xyzzy-abc' }] }],
    });
    expect(result.success).toBe(false);
    expect(result.results[0].exitCode).toBe(127);
    expect(result.results[0].stderr).toContain('Command not found');
  });

  it('returns exitCode 126 and an error message when the cwd does not exist', async () => {
    const result = await call(Exec, {
      intent: 'bad cwd',
      steps: [{ commands: [{ program: 'echo', args: ['hello'], cwd: '/nonexistent/path/xyz123abc' }] }],
    });
    expect(result.success).toBe(false);
    expect(result.results[0].exitCode).toBe(126);
    expect(result.results[0].stderr).toContain('Working directory not found');
  });
});

describe('Exec — blocked rules (extended)', () => {
  // Helper: generates a blocked-rule test inline
  const expectBlocked = (label: string, program: string, args: string[]) =>
    it(label, async () => {
      const result = await call(Exec, {
        intent: label,
        steps: [{ commands: [{ program, args }] }],
      });
      expect(result.success).toBe(false);
      expect(result.results[0].stderr).toContain('BLOCKED');
    });

  expectBlocked('blocks rmdir (no-destructive-commands)', 'rmdir', ['/tmp/x']);
  expectBlocked('blocks sed -i (no-sed-in-place)', 'sed', ['-i', 's/a/b/', '/tmp/test.txt']);
  expectBlocked('blocks sed --in-place (no-sed-in-place)', 'sed', ['--in-place', 's/a/b/', '/tmp/test.txt']);
  expectBlocked('blocks git rm (no-git-rm)', 'git', ['rm', 'file.ts']);
  expectBlocked('blocks git checkout (no-git-checkout)', 'git', ['checkout', 'main']);
  expectBlocked('blocks git reset (no-git-reset)', 'git', ['reset', 'HEAD~1']);
  expectBlocked('blocks git push -f (no-force-push)', 'git', ['push', '-f']);
  expectBlocked('blocks git push --force (no-force-push)', 'git', ['push', '--force']);
  expectBlocked('blocks .exe programs (no-exe)', 'program.exe', []);
  expectBlocked('blocks env without arguments (no-env-dump)', 'env', []);
  expectBlocked('blocks printenv without arguments (no-env-dump)', 'printenv', []);
  expectBlocked('blocks git -C (no-git-C)', 'git', ['-C', '/some/path', 'status']);
  expectBlocked('blocks pnpm -C (no-pnpm-C)', 'pnpm', ['-C', '/some/path', 'install']);
  expectBlocked('blocks git clean (no-git-clean)', 'git', ['clean', '-fd']);
});

describe('Exec — cancellation', () => {
  it('rejects with ToolCancelledError when cancelled mid-execution', async () => {
    const expected = ToolCancelledError;
    const controller = new AbortController();
    const input = Exec.input_schema.parse({
      intent: 'long-running sleep',
      steps: [{ commands: [{ program: 'sleep', args: ['5'] }] }],
    });

    const actual = Exec.handler(input, controller.signal);
    controller.abort();

    await expect(actual).rejects.toBeInstanceOf(expected);
  });
});

describe('Exec — validation is upfront', () => {
  it('a blocked command in any step prevents all steps from running', async () => {
    const result = await call(Exec, {
      intent: 'echo then rm',
      steps: [{ commands: [{ program: 'echo', args: ['should not run'] }] }, { commands: [{ program: 'rm', args: ['/tmp/x'] }] }],
    });
    expect(result.success).toBe(false);
    // Only one synthetic blocked result — the echo step never ran
    expect(result.results).toHaveLength(1);
    expect(result.results[0].stderr).toContain('BLOCKED');
    expect(result.results[0].stdout).toBe('');
  });
});

describe('Exec — chaining: independent', () => {
  it('runs all steps and reports each even after a failure', async () => {
    const result = await call(Exec, {
      intent: 'independent chaining',
      chaining: 'independent',
      steps: [{ commands: [{ program: 'sh', args: ['-c', 'exit 1'] }] }, { commands: [{ program: 'echo', args: ['still runs'] }] }],
    });
    expect(result.results).toHaveLength(2);
    expect(result.results[1].stdout).toBe('still runs');
  });

  it('runs steps concurrently, not sequentially', async () => {
    // Observable interleaving, not wall-clock timing: an injected stub executor records the
    // peak number of runs in flight at once. Independent chaining must run both steps
    // concurrently, so the peak is 2; sequential execution would peak at 1.
    const probe = createInterleavingExecutor(2);
    const exec = createExec(nodeFs, probe.executor);

    await call(exec, {
      intent: 'concurrent steps',
      chaining: 'independent',
      steps: [{ commands: [{ program: 'step1' }] }, { commands: [{ program: 'step2' }] }],
    });

    const expected = 2;
    const actual = probe.maxInFlight();
    expect(actual).toBe(expected);
  });
});
