import { describe, expect, it } from 'vitest';
import { Exec } from '../../src/entry/Exec';
import { call } from '../helpers';

// V1 characterisation tests — one describe per scenario, one assertion per it.
// These lock in current V1 behaviour including quirks (e.g. R4's silent redirect ignore),
// so that phase 2 cannot regress them by accident.
// Source of truth: src/ExecV2/scenarios.md

// ---------------------------------------------------------------------------
// S1 — echo hello
// ---------------------------------------------------------------------------

describe('S1 — echo hello', () => {
  it('success is true', async () => {
    const result = await call(Exec, {
      description: 'S1',
      steps: [{ commands: [{ program: 'echo', args: ['hello'] }] }],
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('stdout is "hello"', async () => {
    const result = await call(Exec, {
      description: 'S1',
      steps: [{ commands: [{ program: 'echo', args: ['hello'] }] }],
    });
    const expected = 'hello';
    const actual = result.results[0].stdout;
    expect(actual).toBe(expected);
  });

  it('exit code is 0', async () => {
    const result = await call(Exec, {
      description: 'S1',
      steps: [{ commands: [{ program: 'echo', args: ['hello'] }] }],
    });
    const expected = 0;
    const actual = result.results[0].exitCode;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// S2 — sh -c 'exit 1'
// ---------------------------------------------------------------------------

describe("S2 — sh -c 'exit 1'", () => {
  it('success is false', async () => {
    const result = await call(Exec, {
      description: 'S2',
      steps: [{ commands: [{ program: 'sh', args: ['-c', 'exit 1'] }] }],
    });
    const expected = false;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('exit code is 1', async () => {
    const result = await call(Exec, {
      description: 'S2',
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
    const result = await call(Exec, {
      description: 'C1',
      chaining: 'sequential',
      steps: [{ commands: [{ program: 'echo', args: ['a'] }] }, { commands: [{ program: 'echo', args: ['b'] }] }],
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('produces two results', async () => {
    const result = await call(Exec, {
      description: 'C1',
      chaining: 'sequential',
      steps: [{ commands: [{ program: 'echo', args: ['a'] }] }, { commands: [{ program: 'echo', args: ['b'] }] }],
    });
    const expected = 2;
    const actual = result.results.length;
    expect(actual).toBe(expected);
  });

  it('first result stdout is "a"', async () => {
    const result = await call(Exec, {
      description: 'C1',
      chaining: 'sequential',
      steps: [{ commands: [{ program: 'echo', args: ['a'] }] }, { commands: [{ program: 'echo', args: ['b'] }] }],
    });
    const expected = 'a';
    const actual = result.results[0].stdout;
    expect(actual).toBe(expected);
  });

  it('second result stdout is "b"', async () => {
    const result = await call(Exec, {
      description: 'C1',
      chaining: 'sequential',
      steps: [{ commands: [{ program: 'echo', args: ['a'] }] }, { commands: [{ program: 'echo', args: ['b'] }] }],
    });
    const expected = 'b';
    const actual = result.results[1].stdout;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// C2 — sh -c 'exit 1'; echo b
// ---------------------------------------------------------------------------

describe("C2 — sh -c 'exit 1'; echo b", () => {
  it('success is false', async () => {
    const result = await call(Exec, {
      description: 'C2',
      chaining: 'sequential',
      steps: [{ commands: [{ program: 'sh', args: ['-c', 'exit 1'] }] }, { commands: [{ program: 'echo', args: ['b'] }] }],
    });
    const expected = false;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('produces two results', async () => {
    const result = await call(Exec, {
      description: 'C2',
      chaining: 'sequential',
      steps: [{ commands: [{ program: 'sh', args: ['-c', 'exit 1'] }] }, { commands: [{ program: 'echo', args: ['b'] }] }],
    });
    const expected = 2;
    const actual = result.results.length;
    expect(actual).toBe(expected);
  });

  it('first result exit code is 1', async () => {
    const result = await call(Exec, {
      description: 'C2',
      chaining: 'sequential',
      steps: [{ commands: [{ program: 'sh', args: ['-c', 'exit 1'] }] }, { commands: [{ program: 'echo', args: ['b'] }] }],
    });
    const expected = 1;
    const actual = result.results[0].exitCode;
    expect(actual).toBe(expected);
  });

  it('second result stdout is "b"', async () => {
    const result = await call(Exec, {
      description: 'C2',
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
    const result = await call(Exec, {
      description: 'A1',
      steps: [{ commands: [{ program: 'echo', args: ['a'] }] }, { commands: [{ program: 'echo', args: ['b'] }] }],
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('first result stdout is "a"', async () => {
    const result = await call(Exec, {
      description: 'A1',
      steps: [{ commands: [{ program: 'echo', args: ['a'] }] }, { commands: [{ program: 'echo', args: ['b'] }] }],
    });
    const expected = 'a';
    const actual = result.results[0].stdout;
    expect(actual).toBe(expected);
  });

  it('second result stdout is "b"', async () => {
    const result = await call(Exec, {
      description: 'A1',
      steps: [{ commands: [{ program: 'echo', args: ['a'] }] }, { commands: [{ program: 'echo', args: ['b'] }] }],
    });
    const expected = 'b';
    const actual = result.results[1].stdout;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// A2 — sh -c 'exit 1' && echo b
// ---------------------------------------------------------------------------

describe("A2 — sh -c 'exit 1' && echo b", () => {
  it('success is false', async () => {
    const result = await call(Exec, {
      description: 'A2',
      steps: [{ commands: [{ program: 'sh', args: ['-c', 'exit 1'] }] }, { commands: [{ program: 'echo', args: ['b'] }] }],
    });
    const expected = false;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('produces one result (right never ran)', async () => {
    const result = await call(Exec, {
      description: 'A2',
      steps: [{ commands: [{ program: 'sh', args: ['-c', 'exit 1'] }] }, { commands: [{ program: 'echo', args: ['b'] }] }],
    });
    const expected = 1;
    const actual = result.results.length;
    expect(actual).toBe(expected);
  });

  it('result exit code is 1', async () => {
    const result = await call(Exec, {
      description: 'A2',
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
    const result = await call(Exec, {
      description: 'N1',
      chaining: 'independent',
      steps: [{ commands: [{ program: 'echo', args: ['a'] }] }, { commands: [{ program: 'echo', args: ['b'] }] }],
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('produces two results', async () => {
    const result = await call(Exec, {
      description: 'N1',
      chaining: 'independent',
      steps: [{ commands: [{ program: 'echo', args: ['a'] }] }, { commands: [{ program: 'echo', args: ['b'] }] }],
    });
    const expected = 2;
    const actual = result.results.length;
    expect(actual).toBe(expected);
  });

  it('first result stdout is "a"', async () => {
    const result = await call(Exec, {
      description: 'N1',
      chaining: 'independent',
      steps: [{ commands: [{ program: 'echo', args: ['a'] }] }, { commands: [{ program: 'echo', args: ['b'] }] }],
    });
    const expected = 'a';
    const actual = result.results[0].stdout;
    expect(actual).toBe(expected);
  });

  it('second result stdout is "b"', async () => {
    const result = await call(Exec, {
      description: 'N1',
      chaining: 'independent',
      steps: [{ commands: [{ program: 'echo', args: ['a'] }] }, { commands: [{ program: 'echo', args: ['b'] }] }],
    });
    const expected = 'b';
    const actual = result.results[1].stdout;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// N2 — sh -c 'exit 1' & echo b & wait
// ---------------------------------------------------------------------------

describe("N2 — sh -c 'exit 1' & echo b & wait", () => {
  it('success is false', async () => {
    const result = await call(Exec, {
      description: 'N2',
      chaining: 'independent',
      steps: [{ commands: [{ program: 'sh', args: ['-c', 'exit 1'] }] }, { commands: [{ program: 'echo', args: ['b'] }] }],
    });
    const expected = false;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('first result exit code is 1', async () => {
    const result = await call(Exec, {
      description: 'N2',
      chaining: 'independent',
      steps: [{ commands: [{ program: 'sh', args: ['-c', 'exit 1'] }] }, { commands: [{ program: 'echo', args: ['b'] }] }],
    });
    const expected = 1;
    const actual = result.results[0].exitCode;
    expect(actual).toBe(expected);
  });

  it('second result stdout is "b"', async () => {
    const result = await call(Exec, {
      description: 'N2',
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
    const result = await call(Exec, {
      description: 'P1',
      steps: [{ commands: [{ program: 'echo', args: ['hello'] }, { program: 'cat' }] }],
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('stdout is "hello" (pipeline collapses to one result)', async () => {
    const result = await call(Exec, {
      description: 'P1',
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
    const result = await call(Exec, {
      description: 'P2',
      steps: [{ commands: [{ program: 'printf', args: ['a\nb\nc\n'] }, { program: 'grep', args: ['b'] }, { program: 'wc', args: ['-l'] }] }],
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('stdout matches wc line count of 1', async () => {
    const result = await call(Exec, {
      description: 'P2',
      steps: [{ commands: [{ program: 'printf', args: ['a\nb\nc\n'] }, { program: 'grep', args: ['b'] }, { program: 'wc', args: ['-l'] }] }],
    });
    const actual = result.results[0].stdout;
    expect(actual).toMatch(/^\s*1$/);
  });
});

// ---------------------------------------------------------------------------
// P3 — sh -c 'echo done; exit 1' | cat (V1 divergence: success is true)
// ---------------------------------------------------------------------------

describe("P3 — sh -c 'echo done; exit 1' | cat", () => {
  it('success is true (V1 reports only the last command exit, which is cat zero)', async () => {
    const result = await call(Exec, {
      description: 'P3',
      steps: [{ commands: [{ program: 'sh', args: ['-c', 'echo done; exit 1'] }, { program: 'cat' }] }],
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('stdout contains output from the failing stage', async () => {
    const result = await call(Exec, {
      description: 'P3',
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
    const result = await call(Exec, {
      description: 'F1',
      steps: [{ commands: [{ program: 'cat', stdin: 'hello' }] }],
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('stdout is "hello"', async () => {
    const result = await call(Exec, {
      description: 'F1',
      steps: [{ commands: [{ program: 'cat', stdin: 'hello' }] }],
    });
    const expected = 'hello';
    const actual = result.results[0].stdout;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// F2 — sh -c 'echo out; echo err >&2' 2>&1 | cat
// ---------------------------------------------------------------------------

describe("F2 — sh -c 'echo out; echo err >&2' 2>&1 | cat", () => {
  it('stdout contains "out"', async () => {
    const result = await call(Exec, {
      description: 'F2',
      steps: [{ commands: [{ program: 'sh', args: ['-c', 'echo out; echo err >&2'], merge_stderr: true }, { program: 'cat' }] }],
    });
    const actual = result.results[0].stdout;
    expect(actual).toContain('out');
  });

  it('stdout contains "err"', async () => {
    const result = await call(Exec, {
      description: 'F2',
      steps: [{ commands: [{ program: 'sh', args: ['-c', 'echo out; echo err >&2'], merge_stderr: true }, { program: 'cat' }] }],
    });
    const actual = result.results[0].stdout;
    expect(actual).toContain('err');
  });
});

// ---------------------------------------------------------------------------
// R1 — echo hello > /dev/null
// ---------------------------------------------------------------------------

describe('R1 — echo hello > /dev/null', () => {
  it('success is true', async () => {
    const result = await call(Exec, {
      description: 'R1',
      steps: [{ commands: [{ program: 'echo', args: ['hello'], redirect: { path: '/dev/null', stream: 'stdout' } }] }],
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('stdout is empty (consumed by redirect)', async () => {
    const result = await call(Exec, {
      description: 'R1',
      steps: [{ commands: [{ program: 'echo', args: ['hello'], redirect: { path: '/dev/null', stream: 'stdout' } }] }],
    });
    const expected = '';
    const actual = result.results[0].stdout;
    expect(actual).toBe(expected);
  });

  it('exit code is 0', async () => {
    const result = await call(Exec, {
      description: 'R1',
      steps: [{ commands: [{ program: 'echo', args: ['hello'], redirect: { path: '/dev/null', stream: 'stdout' } }] }],
    });
    const expected = 0;
    const actual = result.results[0].exitCode;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// R2 — sh -c 'echo err >&2' 2> /dev/null
// ---------------------------------------------------------------------------

describe("R2 — sh -c 'echo err >&2' 2> /dev/null", () => {
  it('success is true', async () => {
    const result = await call(Exec, {
      description: 'R2',
      steps: [{ commands: [{ program: 'sh', args: ['-c', 'echo err >&2'], redirect: { path: '/dev/null', stream: 'stderr' } }] }],
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('stderr is empty (consumed by redirect)', async () => {
    const result = await call(Exec, {
      description: 'R2',
      steps: [{ commands: [{ program: 'sh', args: ['-c', 'echo err >&2'], redirect: { path: '/dev/null', stream: 'stderr' } }] }],
    });
    const expected = '';
    const actual = result.results[0].stderr;
    expect(actual).toBe(expected);
  });

  it('exit code is 0', async () => {
    const result = await call(Exec, {
      description: 'R2',
      steps: [{ commands: [{ program: 'sh', args: ['-c', 'echo err >&2'], redirect: { path: '/dev/null', stream: 'stderr' } }] }],
    });
    const expected = 0;
    const actual = result.results[0].exitCode;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// R3 — echo hello | cat > /dev/null
// ---------------------------------------------------------------------------

describe('R3 — echo hello | cat > /dev/null', () => {
  it('success is true', async () => {
    const result = await call(Exec, {
      description: 'R3',
      steps: [{ commands: [{ program: 'echo', args: ['hello'] }, { program: 'cat', redirect: { path: '/dev/null', stream: 'stdout' } }] }],
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('stdout is "hello" (V1 pipeline does not suppress capture for redirected last command)', async () => {
    // V1 quirk: execPipeline unconditionally adds lastChild.stdout.on('data') before
    // setting up the redirect. Both the capture buffer and the redirect file receive data.
    // This differs from standalone commands (execCommand) which suppress capture when redirected.
    const result = await call(Exec, {
      description: 'R3',
      steps: [{ commands: [{ program: 'echo', args: ['hello'] }, { program: 'cat', redirect: { path: '/dev/null', stream: 'stdout' } }] }],
    });
    const expected = 'hello';
    const actual = result.results[0].stdout;
    expect(actual).toBe(expected);
  });

  it('exit code is 0', async () => {
    const result = await call(Exec, {
      description: 'R3',
      steps: [{ commands: [{ program: 'echo', args: ['hello'] }, { program: 'cat', redirect: { path: '/dev/null', stream: 'stdout' } }] }],
    });
    const expected = 0;
    const actual = result.results[0].exitCode;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// R4 — echo hello > /dev/null | cat (V1 quirk: redirect on pipe-source silently ignored)
// ---------------------------------------------------------------------------

describe('R4 — echo hello > /dev/null | cat', () => {
  it('success is true', async () => {
    const result = await call(Exec, {
      description: 'R4',
      steps: [{ commands: [{ program: 'echo', args: ['hello'], redirect: { path: '/dev/null', stream: 'stdout' } }, { program: 'cat' }] }],
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('stdout is "hello" (V1 silently ignores redirect on non-last pipeline command)', async () => {
    const result = await call(Exec, {
      description: 'R4',
      steps: [{ commands: [{ program: 'echo', args: ['hello'], redirect: { path: '/dev/null', stream: 'stdout' } }, { program: 'cat' }] }],
    });
    const expected = 'hello';
    const actual = result.results[0].stdout;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// R5 — echo "hello world" | tee /dev/null | cat
// ---------------------------------------------------------------------------

describe('R5 — echo "hello world" | tee /dev/null | cat', () => {
  it('success is true', async () => {
    const result = await call(Exec, {
      description: 'R5',
      steps: [{ commands: [{ program: 'echo', args: ['hello world'] }, { program: 'tee', args: ['/dev/null'] }, { program: 'cat' }] }],
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('stdout is "hello world"', async () => {
    const result = await call(Exec, {
      description: 'R5',
      steps: [{ commands: [{ program: 'echo', args: ['hello world'] }, { program: 'tee', args: ['/dev/null'] }, { program: 'cat' }] }],
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
    const result = await call(Exec, {
      description: 'NE2',
      steps: [{ commands: [{ program: 'echo', args: ['hello'] }, { program: 'cat', stdin: 'ignored' }] }],
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('stdout is "hello" (pipe delivers echo output; cat stdin field dropped)', async () => {
    const result = await call(Exec, {
      description: 'NE2',
      steps: [{ commands: [{ program: 'echo', args: ['hello'] }, { program: 'cat', stdin: 'ignored' }] }],
    });
    const expected = 'hello';
    const actual = result.results[0].stdout;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// B1 — rm -rf /tmp/whatever (blocked)
// ---------------------------------------------------------------------------

describe('B1 — rm -rf /tmp/whatever (blocked command)', () => {
  it('success is false', async () => {
    const result = await call(Exec, {
      description: 'B1',
      steps: [{ commands: [{ program: 'rm', args: ['-rf', '/tmp/whatever'] }] }],
    });
    const expected = false;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('stderr contains "BLOCKED"', async () => {
    const result = await call(Exec, {
      description: 'B1',
      steps: [{ commands: [{ program: 'rm', args: ['-rf', '/tmp/whatever'] }] }],
    });
    const actual = result.results[0].stderr;
    expect(actual).toContain('BLOCKED');
  });

  it('stderr names the rule', async () => {
    const result = await call(Exec, {
      description: 'B1',
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
    const result = await call(Exec, {
      description: 'ER1',
      steps: [{ commands: [{ program: 'definitely-not-a-real-command-xyzzy-abc' }] }],
    });
    const expected = false;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('exit code is 127', async () => {
    const result = await call(Exec, {
      description: 'ER1',
      steps: [{ commands: [{ program: 'definitely-not-a-real-command-xyzzy-abc' }] }],
    });
    const expected = 127;
    const actual = result.results[0].exitCode;
    expect(actual).toBe(expected);
  });

  it('stderr contains "Command not found"', async () => {
    const result = await call(Exec, {
      description: 'ER1',
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
    const result = await call(Exec, {
      description: 'ER2',
      steps: [{ commands: [{ program: 'echo', args: ['hello'], cwd: '/nonexistent/path/xyz123abc' }] }],
    });
    const expected = false;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('exit code is 126', async () => {
    const result = await call(Exec, {
      description: 'ER2',
      steps: [{ commands: [{ program: 'echo', args: ['hello'], cwd: '/nonexistent/path/xyz123abc' }] }],
    });
    const expected = 126;
    const actual = result.results[0].exitCode;
    expect(actual).toBe(expected);
  });

  it('stderr contains "Working directory not found"', async () => {
    const result = await call(Exec, {
      description: 'ER2',
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
    const result = await call(Exec, {
      description: 'ER3',
      steps: [{ commands: [{ program: 'definitely-not-a-real-command-xyzzy-abc' }, { program: 'cat' }] }],
    });
    const expected = false;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('stderr contains "Command not found"', async () => {
    const result = await call(Exec, {
      description: 'ER3',
      steps: [{ commands: [{ program: 'definitely-not-a-real-command-xyzzy-abc' }, { program: 'cat' }] }],
    });
    const actual = result.results[0].stderr;
    expect(actual).toContain('Command not found');
  });
});

// ---------------------------------------------------------------------------
// PATH1 — path normalisation (~ expands to home directory)
// ---------------------------------------------------------------------------

describe('PATH1 — path normalisation: ~ in cwd', () => {
  it('success is true (~ was expanded, cwd-not-found check did not trip)', async () => {
    const result = await call(Exec, {
      description: 'PATH1',
      steps: [{ commands: [{ program: 'echo', args: ['hello'], cwd: '~' }] }],
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('expands ~ to the home directory', async () => {
    const result = await call(Exec, {
      description: 'PATH1',
      steps: [{ commands: [{ program: 'node', args: ['-e', 'process.stdout.write(process.cwd())'], cwd: '~' }] }],
    });
    const expected = process.env['HOME'];
    const actual = result.results[0].stdout;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// CF1 — cwd per command
// ---------------------------------------------------------------------------

describe('CF1 — node -e process.stdout.write(process.cwd()) with cwd "/"', () => {
  it('success is true', async () => {
    const result = await call(Exec, {
      description: 'CF1',
      steps: [{ commands: [{ program: 'node', args: ['-e', 'process.stdout.write(process.cwd())'], cwd: '/' }] }],
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('stdout is "/"', async () => {
    const result = await call(Exec, {
      description: 'CF1',
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

describe('CF2 — EXEC_V2_TEST_VAR=hello node -e process.env.EXEC_V2_TEST_VAR', () => {
  it('success is true', async () => {
    const result = await call(Exec, {
      description: 'CF2',
      steps: [{ commands: [{ program: 'node', args: ['-e', "process.stdout.write(process.env['EXEC_V2_TEST_VAR'] ?? 'missing')"], env: { EXEC_V2_TEST_VAR: 'hello' } }] }],
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('stdout is "hello"', async () => {
    const result = await call(Exec, {
      description: 'CF2',
      steps: [{ commands: [{ program: 'node', args: ['-e', "process.stdout.write(process.env['EXEC_V2_TEST_VAR'] ?? 'missing')"], env: { EXEC_V2_TEST_VAR: 'hello' } }] }],
    });
    const expected = 'hello';
    const actual = result.results[0].stdout;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// TO1 — timeout kills sleep 1 after 100ms
// ---------------------------------------------------------------------------

describe('TO1 — timeout 100ms kills sleep 1', () => {
  it('success is false', async () => {
    const result = await call(Exec, {
      description: 'TO1',
      timeout: 100,
      steps: [{ commands: [{ program: 'sleep', args: ['1'] }] }],
    });
    const expected = false;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('exit code is null (killed, not exited)', async () => {
    const result = await call(Exec, {
      description: 'TO1',
      timeout: 100,
      steps: [{ commands: [{ program: 'sleep', args: ['1'] }] }],
    });
    const expected = null;
    const actual = result.results[0].exitCode;
    expect(actual).toBe(expected);
  });

  it('signal is set', async () => {
    const result = await call(Exec, {
      description: 'TO1',
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
    const result = await call(Exec, {
      description: 'SA1-default',
      steps: [{ commands: [{ program: 'node', args: ['-e', "process.stdout.write('\\x1b[31mred\\x1b[0m')"] }] }],
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('stdout is "red" with ANSI stripped', async () => {
    const result = await call(Exec, {
      description: 'SA1-default',
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
    const result = await call(Exec, {
      description: 'SA1-preserved',
      stripAnsi: false,
      steps: [{ commands: [{ program: 'node', args: ['-e', "process.stdout.write('\\x1b[31mred\\x1b[0m')"] }] }],
    });
    const expected = true;
    const actual = result.results[0].stdout.includes('\x1b[');
    expect(actual).toBe(expected);
  });
});
