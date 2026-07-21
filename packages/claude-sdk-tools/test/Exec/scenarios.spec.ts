import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { createExec } from '../../src/Exec/Exec';
import { execute } from '../../src/Exec/execute';
import { ExecInputSchema } from '../../src/Exec/schema';
import { stripAnsi } from '../../src/Exec/stripAnsi';
import { FakeExecutor, shellLikeResponder } from '../FakeExecutor';
import { call } from '../helpers';
import { MemoryFileSystem } from '../MemoryFileSystem';

// V1 characterisation tests — one describe per scenario, one assertion per it.
// These lock in current V1 behaviour including quirks (e.g. R4's silent redirect ignore),
// so that phase 2 cannot regress them by accident.
// Source of truth: src/ExecV2/scenarios.md
//
// `run()` drives the engine (execute) directly, the same way the tool's handler does minus
// the rule check — these tests are about execution mechanics (pipes, chaining, redirects),
// never about which commands a safety rule blocks, so they never touch the rule validator at
// all. Only `B1` (below) deliberately keeps the real gated tool, since testing the block is
// its whole point.

const fs = new MemoryFileSystem();
const executor = new FakeExecutor(shellLikeResponder());
const Exec = createExec(fs, executor);

async function run(input: z.input<typeof ExecInputSchema>) {
  const parsed = ExecInputSchema.parse(input);
  const result = await execute(parsed, process.cwd(), undefined, executor, fs);
  const clean = parsed.stripAnsi ? stripAnsi : (s: string) => s;
  return {
    results: result.results.map((r) => ({ ...r, stdout: clean(r.stdout).trimEnd(), stderr: clean(r.stderr).trimEnd() })),
    success: result.success,
  };
}

// ---------------------------------------------------------------------------
// S1 — echo hello
// ---------------------------------------------------------------------------

describe('S1 — echo hello', () => {
  it('success is true', async () => {
    const result = await run({
      intent: 'S1',
      steps: [{ commands: [{ program: 'echo', args: ['hello'] }] }],
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('stdout is "hello"', async () => {
    const result = await run({
      intent: 'S1',
      steps: [{ commands: [{ program: 'echo', args: ['hello'] }] }],
    });
    const expected = 'hello';
    const actual = result.results[0].stdout;
    expect(actual).toBe(expected);
  });

  it('exit code is 0', async () => {
    const result = await run({
      intent: 'S1',
      steps: [{ commands: [{ program: 'echo', args: ['hello'] }] }],
    });
    const expected = 0;
    const actual = result.results[0].exitCode;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// S2 — a command that exits 1
// ---------------------------------------------------------------------------

describe('S2 — a command that exits 1', () => {
  it('success is false', async () => {
    const result = await run({
      intent: 'S2',
      steps: [{ commands: [{ program: 'sh', args: ['-c', 'exit 1'] }] }],
    });
    const expected = false;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('exit code is 1', async () => {
    const result = await run({
      intent: 'S2',
      steps: [{ commands: [{ program: 'sh', args: ['-c', 'exit 1'] }] }],
    });
    const expected = 1;
    const actual = result.results[0].exitCode;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// C1 — echo a; echo b
// ---------------------------------------------------------------------------

describe('C1 — echo a; echo b', () => {
  it('success is true', async () => {
    const result = await run({
      intent: 'C1',
      chaining: 'sequential',
      steps: [{ commands: [{ program: 'echo', args: ['a'] }] }, { commands: [{ program: 'echo', args: ['b'] }] }],
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('produces two results', async () => {
    const result = await run({
      intent: 'C1',
      chaining: 'sequential',
      steps: [{ commands: [{ program: 'echo', args: ['a'] }] }, { commands: [{ program: 'echo', args: ['b'] }] }],
    });
    const expected = 2;
    const actual = result.results.length;
    expect(actual).toBe(expected);
  });

  it('first result stdout is "a"', async () => {
    const result = await run({
      intent: 'C1',
      chaining: 'sequential',
      steps: [{ commands: [{ program: 'echo', args: ['a'] }] }, { commands: [{ program: 'echo', args: ['b'] }] }],
    });
    const expected = 'a';
    const actual = result.results[0].stdout;
    expect(actual).toBe(expected);
  });

  it('second result stdout is "b"', async () => {
    const result = await run({
      intent: 'C1',
      chaining: 'sequential',
      steps: [{ commands: [{ program: 'echo', args: ['a'] }] }, { commands: [{ program: 'echo', args: ['b'] }] }],
    });
    const expected = 'b';
    const actual = result.results[1].stdout;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// C2 — a command that exits 1; echo b
// ---------------------------------------------------------------------------

describe('C2 — a command that exits 1; echo b', () => {
  it('success is false', async () => {
    const result = await run({
      intent: 'C2',
      chaining: 'sequential',
      steps: [{ commands: [{ program: 'sh', args: ['-c', 'exit 1'] }] }, { commands: [{ program: 'echo', args: ['b'] }] }],
    });
    const expected = false;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('produces two results', async () => {
    const result = await run({
      intent: 'C2',
      chaining: 'sequential',
      steps: [{ commands: [{ program: 'sh', args: ['-c', 'exit 1'] }] }, { commands: [{ program: 'echo', args: ['b'] }] }],
    });
    const expected = 2;
    const actual = result.results.length;
    expect(actual).toBe(expected);
  });

  it('first result exit code is 1', async () => {
    const result = await run({
      intent: 'C2',
      chaining: 'sequential',
      steps: [{ commands: [{ program: 'sh', args: ['-c', 'exit 1'] }] }, { commands: [{ program: 'echo', args: ['b'] }] }],
    });
    const expected = 1;
    const actual = result.results[0].exitCode;
    expect(actual).toBe(expected);
  });

  it('second result stdout is "b"', async () => {
    const result = await run({
      intent: 'C2',
      chaining: 'sequential',
      steps: [{ commands: [{ program: 'sh', args: ['-c', 'exit 1'] }] }, { commands: [{ program: 'echo', args: ['b'] }] }],
    });
    const expected = 'b';
    const actual = result.results[1].stdout;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// A1 — echo a && echo b
// ---------------------------------------------------------------------------

describe('A1 — echo a && echo b', () => {
  it('success is true', async () => {
    const result = await run({
      intent: 'A1',
      steps: [{ commands: [{ program: 'echo', args: ['a'] }] }, { commands: [{ program: 'echo', args: ['b'] }] }],
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('first result stdout is "a"', async () => {
    const result = await run({
      intent: 'A1',
      steps: [{ commands: [{ program: 'echo', args: ['a'] }] }, { commands: [{ program: 'echo', args: ['b'] }] }],
    });
    const expected = 'a';
    const actual = result.results[0].stdout;
    expect(actual).toBe(expected);
  });

  it('second result stdout is "b"', async () => {
    const result = await run({
      intent: 'A1',
      steps: [{ commands: [{ program: 'echo', args: ['a'] }] }, { commands: [{ program: 'echo', args: ['b'] }] }],
    });
    const expected = 'b';
    const actual = result.results[1].stdout;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// A2 — a command that exits 1 && echo b
// ---------------------------------------------------------------------------

describe('A2 — a command that exits 1 && echo b', () => {
  it('success is false', async () => {
    const result = await run({
      intent: 'A2',
      steps: [{ commands: [{ program: 'sh', args: ['-c', 'exit 1'] }] }, { commands: [{ program: 'echo', args: ['b'] }] }],
    });
    const expected = false;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('produces one result (right never ran)', async () => {
    const result = await run({
      intent: 'A2',
      steps: [{ commands: [{ program: 'sh', args: ['-c', 'exit 1'] }] }, { commands: [{ program: 'echo', args: ['b'] }] }],
    });
    const expected = 1;
    const actual = result.results.length;
    expect(actual).toBe(expected);
  });

  it('result exit code is 1', async () => {
    const result = await run({
      intent: 'A2',
      steps: [{ commands: [{ program: 'sh', args: ['-c', 'exit 1'] }] }, { commands: [{ program: 'echo', args: ['b'] }] }],
    });
    const expected = 1;
    const actual = result.results[0].exitCode;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// N1 — echo a & echo b & wait (independent/concurrent)
// ---------------------------------------------------------------------------

describe('N1 — echo a & echo b & wait', () => {
  it('success is true', async () => {
    const result = await run({
      intent: 'N1',
      chaining: 'independent',
      steps: [{ commands: [{ program: 'echo', args: ['a'] }] }, { commands: [{ program: 'echo', args: ['b'] }] }],
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('produces two results', async () => {
    const result = await run({
      intent: 'N1',
      chaining: 'independent',
      steps: [{ commands: [{ program: 'echo', args: ['a'] }] }, { commands: [{ program: 'echo', args: ['b'] }] }],
    });
    const expected = 2;
    const actual = result.results.length;
    expect(actual).toBe(expected);
  });

  it('first result stdout is "a"', async () => {
    const result = await run({
      intent: 'N1',
      chaining: 'independent',
      steps: [{ commands: [{ program: 'echo', args: ['a'] }] }, { commands: [{ program: 'echo', args: ['b'] }] }],
    });
    const expected = 'a';
    const actual = result.results[0].stdout;
    expect(actual).toBe(expected);
  });

  it('second result stdout is "b"', async () => {
    const result = await run({
      intent: 'N1',
      chaining: 'independent',
      steps: [{ commands: [{ program: 'echo', args: ['a'] }] }, { commands: [{ program: 'echo', args: ['b'] }] }],
    });
    const expected = 'b';
    const actual = result.results[1].stdout;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// N2 — a command that exits 1 & echo b & wait
// ---------------------------------------------------------------------------

describe('N2 — a command that exits 1 & echo b & wait', () => {
  it('success is false', async () => {
    const result = await run({
      intent: 'N2',
      chaining: 'independent',
      steps: [{ commands: [{ program: 'sh', args: ['-c', 'exit 1'] }] }, { commands: [{ program: 'echo', args: ['b'] }] }],
    });
    const expected = false;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('first result exit code is 1', async () => {
    const result = await run({
      intent: 'N2',
      chaining: 'independent',
      steps: [{ commands: [{ program: 'sh', args: ['-c', 'exit 1'] }] }, { commands: [{ program: 'echo', args: ['b'] }] }],
    });
    const expected = 1;
    const actual = result.results[0].exitCode;
    expect(actual).toBe(expected);
  });

  it('second result stdout is "b"', async () => {
    const result = await run({
      intent: 'N2',
      chaining: 'independent',
      steps: [{ commands: [{ program: 'sh', args: ['-c', 'exit 1'] }] }, { commands: [{ program: 'echo', args: ['b'] }] }],
    });
    const expected = 'b';
    const actual = result.results[1].stdout;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// P1 — echo hello | cat
// ---------------------------------------------------------------------------

describe('P1 — echo hello | cat', () => {
  it('success is true', async () => {
    const result = await run({
      intent: 'P1',
      steps: [{ commands: [{ program: 'echo', args: ['hello'] }, { program: 'cat' }] }],
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('stdout is "hello" (pipeline collapses to one result)', async () => {
    const result = await run({
      intent: 'P1',
      steps: [{ commands: [{ program: 'echo', args: ['hello'] }, { program: 'cat' }] }],
    });
    const expected = 'hello';
    const actual = result.results[0].stdout;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// P2 — printf 'a\nb\nc\n' | grep b | wc -l
// ---------------------------------------------------------------------------

describe("P2 — printf 'a\\nb\\nc\\n' | grep b | wc -l", () => {
  it('success is true', async () => {
    const result = await run({
      intent: 'P2',
      steps: [
        {
          commands: [
            { program: 'printf', args: ['a\nb\nc\n'] },
            { program: 'grep', args: ['b'] },
            { program: 'wc', args: ['-l'] },
          ],
        },
      ],
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('stdout matches wc line count of 1', async () => {
    const result = await run({
      intent: 'P2',
      steps: [
        {
          commands: [
            { program: 'printf', args: ['a\nb\nc\n'] },
            { program: 'grep', args: ['b'] },
            { program: 'wc', args: ['-l'] },
          ],
        },
      ],
    });
    const actual = result.results[0].stdout;
    expect(actual).toMatch(/^\s*1$/);
  });
});

// ---------------------------------------------------------------------------
// P3 — a failing producer | cat (V1 divergence: success is true)
// ---------------------------------------------------------------------------

describe('P3 — a failing producer | cat', () => {
  it('success is true (V1 reports only the last command exit, which is cat zero)', async () => {
    const result = await run({
      intent: 'P3',
      steps: [{ commands: [{ program: 'sh', args: ['-c', 'echo done; exit 1'] }, { program: 'cat' }] }],
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('stdout contains output from the failing stage', async () => {
    const result = await run({
      intent: 'P3',
      steps: [{ commands: [{ program: 'sh', args: ['-c', 'echo done; exit 1'] }, { program: 'cat' }] }],
    });
    const expected = 'done';
    const actual = result.results[0].stdout;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// F1 — cat <<<'hello'
// ---------------------------------------------------------------------------

describe("F1 — cat <<<'hello'", () => {
  it('success is true', async () => {
    const result = await run({
      intent: 'F1',
      steps: [{ commands: [{ program: 'cat', stdin: 'hello' }] }],
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('stdout is "hello"', async () => {
    const result = await run({
      intent: 'F1',
      steps: [{ commands: [{ program: 'cat', stdin: 'hello' }] }],
    });
    const expected = 'hello';
    const actual = result.results[0].stdout;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// F2 — a command writing both stdout and stderr, merged | cat
// ---------------------------------------------------------------------------

describe('F2 — stdout and stderr merged | cat', () => {
  it('stdout contains "out"', async () => {
    const result = await run({
      intent: 'F2',
      steps: [{ commands: [{ program: 'sh', args: ['-c', 'echo out; echo err >&2'], merge_stderr: true }, { program: 'cat' }] }],
    });
    const actual = result.results[0].stdout;
    expect(actual).toContain('out');
  });

  it('stdout contains "err"', async () => {
    const result = await run({
      intent: 'F2',
      steps: [{ commands: [{ program: 'sh', args: ['-c', 'echo out; echo err >&2'], merge_stderr: true }, { program: 'cat' }] }],
    });
    const actual = result.results[0].stdout;
    expect(actual).toContain('err');
  });
});

// ---------------------------------------------------------------------------
// R1 — echo hello > (redirect)
// ---------------------------------------------------------------------------

describe('R1 — echo hello > (redirect)', () => {
  it('success is true', async () => {
    const result = await run({
      intent: 'R1',
      steps: [{ commands: [{ program: 'echo', args: ['hello'], redirect: { path: '/cwd/discard.txt', stream: 'stdout' } }] }],
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('stdout is empty (consumed by redirect)', async () => {
    const result = await run({
      intent: 'R1',
      steps: [{ commands: [{ program: 'echo', args: ['hello'], redirect: { path: '/cwd/discard.txt', stream: 'stdout' } }] }],
    });
    const expected = '';
    const actual = result.results[0].stdout;
    expect(actual).toBe(expected);
  });

  it('exit code is 0', async () => {
    const result = await run({
      intent: 'R1',
      steps: [{ commands: [{ program: 'echo', args: ['hello'], redirect: { path: '/cwd/discard.txt', stream: 'stdout' } }] }],
    });
    const expected = 0;
    const actual = result.results[0].exitCode;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// R2 — a command writing to stderr, 2> (redirect)
// ---------------------------------------------------------------------------

describe('R2 — stderr redirected', () => {
  it('success is true', async () => {
    const result = await run({
      intent: 'R2',
      steps: [{ commands: [{ program: 'sh', args: ['-c', 'echo err >&2'], redirect: { path: '/cwd/discard.txt', stream: 'stderr' } }] }],
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('stderr is empty (consumed by redirect)', async () => {
    const result = await run({
      intent: 'R2',
      steps: [{ commands: [{ program: 'sh', args: ['-c', 'echo err >&2'], redirect: { path: '/cwd/discard.txt', stream: 'stderr' } }] }],
    });
    const expected = '';
    const actual = result.results[0].stderr;
    expect(actual).toBe(expected);
  });

  it('exit code is 0', async () => {
    const result = await run({
      intent: 'R2',
      steps: [{ commands: [{ program: 'sh', args: ['-c', 'echo err >&2'], redirect: { path: '/cwd/discard.txt', stream: 'stderr' } }] }],
    });
    const expected = 0;
    const actual = result.results[0].exitCode;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// R3 — echo hello | cat > (redirect)
// ---------------------------------------------------------------------------

describe('R3 — echo hello | cat > (redirect)', () => {
  it('success is true', async () => {
    const result = await run({
      intent: 'R3',
      steps: [
        {
          commands: [
            { program: 'echo', args: ['hello'] },
            { program: 'cat', redirect: { path: '/cwd/discard.txt', stream: 'stdout' } },
          ],
        },
      ],
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('stdout is "hello" (V1 pipeline does not suppress capture for redirected last command)', async () => {
    // V1 quirk: execPipeline unconditionally adds lastChild.stdout.on('data') before
    // setting up the redirect. Both the capture buffer and the redirect file receive data.
    // This differs from standalone commands (execCommand) which suppress capture when redirected.
    const result = await run({
      intent: 'R3',
      steps: [
        {
          commands: [
            { program: 'echo', args: ['hello'] },
            { program: 'cat', redirect: { path: '/cwd/discard.txt', stream: 'stdout' } },
          ],
        },
      ],
    });
    const expected = 'hello';
    const actual = result.results[0].stdout;
    expect(actual).toBe(expected);
  });

  it('exit code is 0', async () => {
    const result = await run({
      intent: 'R3',
      steps: [
        {
          commands: [
            { program: 'echo', args: ['hello'] },
            { program: 'cat', redirect: { path: '/cwd/discard.txt', stream: 'stdout' } },
          ],
        },
      ],
    });
    const expected = 0;
    const actual = result.results[0].exitCode;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// R4 — echo hello > (redirect) | cat (V1 quirk: redirect on pipe-source silently ignored)
// ---------------------------------------------------------------------------

describe('R4 — echo hello > (redirect) | cat', () => {
  it('success is true', async () => {
    const result = await run({
      intent: 'R4',
      steps: [{ commands: [{ program: 'echo', args: ['hello'], redirect: { path: '/cwd/discard.txt', stream: 'stdout' } }, { program: 'cat' }] }],
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('stdout is "hello" (V1 silently ignores redirect on non-last pipeline command)', async () => {
    const result = await run({
      intent: 'R4',
      steps: [{ commands: [{ program: 'echo', args: ['hello'], redirect: { path: '/cwd/discard.txt', stream: 'stdout' } }, { program: 'cat' }] }],
    });
    const expected = 'hello';
    const actual = result.results[0].stdout;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// R5 — echo "hello world" | tee (redirect) | cat
// ---------------------------------------------------------------------------

describe('R5 — echo "hello world" | tee (redirect) | cat', () => {
  it('success is true', async () => {
    const result = await run({
      intent: 'R5',
      steps: [{ commands: [{ program: 'echo', args: ['hello world'] }, { program: 'tee', args: ['/cwd/discard.txt'] }, { program: 'cat' }] }],
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('stdout is "hello world"', async () => {
    const result = await run({
      intent: 'R5',
      steps: [{ commands: [{ program: 'echo', args: ['hello world'] }, { program: 'tee', args: ['/cwd/discard.txt'] }, { program: 'cat' }] }],
    });
    const expected = 'hello world';
    const actual = result.results[0].stdout;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// NE2 — stdin on a right-of-pipe command (V1 silently drops it)
// ---------------------------------------------------------------------------

describe('NE2 — echo hello | cat (stdin on right-of-pipe is silently dropped)', () => {
  it('success is true', async () => {
    const result = await run({
      intent: 'NE2',
      steps: [
        {
          commands: [
            { program: 'echo', args: ['hello'] },
            { program: 'cat', stdin: 'ignored' },
          ],
        },
      ],
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('stdout is "hello" (pipe delivers echo output; cat stdin field dropped)', async () => {
    const result = await run({
      intent: 'NE2',
      steps: [
        {
          commands: [
            { program: 'echo', args: ['hello'] },
            { program: 'cat', stdin: 'ignored' },
          ],
        },
      ],
    });
    const expected = 'hello';
    const actual = result.results[0].stdout;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// B1 — rm -rf /tmp/whatever (blocked)
// ---------------------------------------------------------------------------
//
// The one describe in this file that deliberately keeps the real gated tool: testing
// that a rule blocks a command is the whole point here, unlike everything above.

describe('B1 — rm -rf /tmp/whatever (blocked command)', () => {
  it('success is false', async () => {
    const result = await call(Exec, {
      intent: 'B1',
      steps: [{ commands: [{ program: 'rm', args: ['-rf', '/tmp/whatever'] }] }],
    });
    const expected = false;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('stderr contains "BLOCKED"', async () => {
    const result = await call(Exec, {
      intent: 'B1',
      steps: [{ commands: [{ program: 'rm', args: ['-rf', '/tmp/whatever'] }] }],
    });
    const actual = result.results[0].stderr;
    expect(actual).toContain('BLOCKED');
  });

  it('stderr names the rule', async () => {
    const result = await call(Exec, {
      intent: 'B1',
      steps: [{ commands: [{ program: 'rm', args: ['-rf', '/tmp/whatever'] }] }],
    });
    const actual = result.results[0].stderr;
    expect(actual).toContain('no-destructive-commands');
  });
});

// ---------------------------------------------------------------------------
// ER1 — command not found (standalone)
// ---------------------------------------------------------------------------

describe('ER1 — definitely-not-a-real-command-xyzzy-abc', () => {
  it('success is false', async () => {
    const result = await run({
      intent: 'ER1',
      steps: [{ commands: [{ program: 'definitely-not-a-real-command-xyzzy-abc' }] }],
    });
    const expected = false;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('exit code is 127', async () => {
    const result = await run({
      intent: 'ER1',
      steps: [{ commands: [{ program: 'definitely-not-a-real-command-xyzzy-abc' }] }],
    });
    const expected = 127;
    const actual = result.results[0].exitCode;
    expect(actual).toBe(expected);
  });

  it('stderr contains "Command not found"', async () => {
    const result = await run({
      intent: 'ER1',
      steps: [{ commands: [{ program: 'definitely-not-a-real-command-xyzzy-abc' }] }],
    });
    const actual = result.results[0].stderr;
    expect(actual).toContain('Command not found');
  });
});

// ---------------------------------------------------------------------------
// ER2 — cwd not found
// ---------------------------------------------------------------------------

describe('ER2 — echo hello with cwd /nonexistent/path/xyz123abc', () => {
  it('success is false', async () => {
    const result = await run({
      intent: 'ER2',
      steps: [{ commands: [{ program: 'echo', args: ['hello'], cwd: '/nonexistent/path/xyz123abc' }] }],
    });
    const expected = false;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('exit code is 126', async () => {
    const result = await run({
      intent: 'ER2',
      steps: [{ commands: [{ program: 'echo', args: ['hello'], cwd: '/nonexistent/path/xyz123abc' }] }],
    });
    const expected = 126;
    const actual = result.results[0].exitCode;
    expect(actual).toBe(expected);
  });

  it('stderr contains "Working directory not found"', async () => {
    const result = await run({
      intent: 'ER2',
      steps: [{ commands: [{ program: 'echo', args: ['hello'], cwd: '/nonexistent/path/xyz123abc' }] }],
    });
    const actual = result.results[0].stderr;
    expect(actual).toContain('Working directory not found');
  });
});

// ---------------------------------------------------------------------------
// ER3 — command not found inside a pipeline
// ---------------------------------------------------------------------------

describe('ER3 — definitely-not-a-real-command-xyzzy-abc | cat', () => {
  it('success is false', async () => {
    const result = await run({
      intent: 'ER3',
      steps: [{ commands: [{ program: 'definitely-not-a-real-command-xyzzy-abc' }, { program: 'cat' }] }],
    });
    const expected = false;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('stderr contains "Command not found"', async () => {
    const result = await run({
      intent: 'ER3',
      steps: [{ commands: [{ program: 'definitely-not-a-real-command-xyzzy-abc' }, { program: 'cat' }] }],
    });
    const actual = result.results[0].stderr;
    expect(actual).toContain('Command not found');
  });
});

// ---------------------------------------------------------------------------
// ER4 — bad cwd on a non-final pipeline stage
// ---------------------------------------------------------------------------

describe('ER4 — echo hello with bad cwd | cat', () => {
  it('success is false', async () => {
    const result = await run({
      intent: 'ER4',
      steps: [{ commands: [{ program: 'echo', args: ['hello'], cwd: '/nonexistent/path/xyz123abc' }, { program: 'cat' }] }],
    });
    const expected = false;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  // A bad working directory reports 126 ("cannot execute") regardless of pipeline
  // position — the same exit code as the standalone case (ER2), not 127.
  it('exit code is 126', async () => {
    const result = await run({
      intent: 'ER4',
      steps: [{ commands: [{ program: 'echo', args: ['hello'], cwd: '/nonexistent/path/xyz123abc' }, { program: 'cat' }] }],
    });
    const expected = 126;
    const actual = result.results[0].exitCode;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// CF1 — cwd per command
// ---------------------------------------------------------------------------

describe('CF1 — process.cwd() reflects cwd "/"', () => {
  it('success is true', async () => {
    const result = await run({
      intent: 'CF1',
      steps: [{ commands: [{ program: 'node', args: ['-e', 'process.stdout.write(process.cwd())'], cwd: '/' }] }],
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('stdout is "/"', async () => {
    const result = await run({
      intent: 'CF1',
      steps: [{ commands: [{ program: 'node', args: ['-e', 'process.stdout.write(process.cwd())'], cwd: '/' }] }],
    });
    const expected = '/';
    const actual = result.results[0].stdout;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// CF2 — env per command
// ---------------------------------------------------------------------------

describe('CF2 — EXEC_V2_TEST_VAR=hello reflected in env', () => {
  it('success is true', async () => {
    const result = await run({
      intent: 'CF2',
      steps: [{ commands: [{ program: 'node', args: ['-e', "process.stdout.write(process.env['EXEC_V2_TEST_VAR'] ?? 'missing')"], env: { EXEC_V2_TEST_VAR: 'hello' } }] }],
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('stdout is "hello"', async () => {
    const result = await run({
      intent: 'CF2',
      steps: [{ commands: [{ program: 'node', args: ['-e', "process.stdout.write(process.env['EXEC_V2_TEST_VAR'] ?? 'missing')"], env: { EXEC_V2_TEST_VAR: 'hello' } }] }],
    });
    const expected = 'hello';
    const actual = result.results[0].stdout;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// TO1 — a killed status flows through to the result shape
// ---------------------------------------------------------------------------
//
// FakeExecutor never really sleeps, so this doesn't prove a real timeout kills a real
// process — that's test/integration/timeout.spec.ts (real spawn, real sleep, real kill).
// This only proves an already-killed status (exitCode null, a signal set) is reported
// correctly by the tool — so, unlike the mechanics tests above, it does need the real
// tool (for its timeout wiring), not the bare engine.

describe('TO1 — a killed status is reported correctly (not a real timeout — see integration)', () => {
  const slowExec = createExec(new MemoryFileSystem(), new FakeExecutor(() => ({ exitCode: null, signal: 'SIGTERM' })));

  it('success is false', async () => {
    const result = await call(slowExec, {
      intent: 'TO1',
      timeout: 100,
      steps: [{ commands: [{ program: 'sleep', args: ['1'] }] }],
    });
    const expected = false;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('exit code is null (killed, not exited)', async () => {
    const result = await call(slowExec, {
      intent: 'TO1',
      timeout: 100,
      steps: [{ commands: [{ program: 'sleep', args: ['1'] }] }],
    });
    const expected = null;
    const actual = result.results[0].exitCode;
    expect(actual).toBe(expected);
  });

  it('signal is set', async () => {
    const result = await call(slowExec, {
      intent: 'TO1',
      timeout: 100,
      steps: [{ commands: [{ program: 'sleep', args: ['1'] }] }],
    });
    const expected = true;
    const actual = result.results[0].signal !== null;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// SA1-default — stripAnsi: true (default) strips ANSI codes
// ---------------------------------------------------------------------------

describe('SA1-default — stripAnsi true (default) strips ANSI codes', () => {
  it('success is true', async () => {
    const result = await run({
      intent: 'SA1-default',
      steps: [{ commands: [{ program: 'node', args: ['-e', "process.stdout.write('\\x1b[31mred\\x1b[0m')"] }] }],
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('stdout is "red" with ANSI stripped', async () => {
    const result = await run({
      intent: 'SA1-default',
      steps: [{ commands: [{ program: 'node', args: ['-e', "process.stdout.write('\\x1b[31mred\\x1b[0m')"] }] }],
    });
    const expected = 'red';
    const actual = result.results[0].stdout;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// SA1-preserved — stripAnsi: false preserves ANSI codes
// ---------------------------------------------------------------------------

describe('SA1-preserved — stripAnsi false preserves ANSI codes', () => {
  it('stdout contains ANSI escape sequence', async () => {
    const result = await run({
      intent: 'SA1-preserved',
      stripAnsi: false,
      steps: [{ commands: [{ program: 'node', args: ['-e', "process.stdout.write('\\x1b[31mred\\x1b[0m')"] }] }],
    });
    const expected = true;
    const actual = result.results[0].stdout.includes('\x1b[');
    expect(actual).toBe(expected);
  });
});
