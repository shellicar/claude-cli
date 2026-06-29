import { describe, expect, it } from 'vitest';
import { ExecV3 } from '../../src/entry/ExecV3';
import { ExecV3InputSchema } from '../../src/ExecV3/schema';
import { call } from '../helpers';

// ExecV3 scenario tests — one describe per scenario, one assertion per it, expected/actual
// variables. Each scenario names its bash equivalent; the JSON is that bash, structured.
// results[i] is CommandResult | null (null = short-circuited), so a slot that ran is read
// with `?.` and a skipped slot is asserted `=== null`.

// ---------------------------------------------------------------------------
// single — bash: echo hello
// ---------------------------------------------------------------------------

describe('single — echo hello', () => {
  const input = { intent: 'echo hello', commands: [{ program: 'echo', args: ['hello'] }] };

  it('produces one result', async () => {
    const result = await call(ExecV3, input);
    const expected = 1;
    const actual = result.results.length;
    expect(actual).toBe(expected);
  });

  it('stdout is "hello"', async () => {
    const result = await call(ExecV3, input);
    const expected = 'hello';
    const actual = result.results[0]?.stdout;
    expect(actual).toBe(expected);
  });

  it('success is true', async () => {
    const result = await call(ExecV3, input);
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('exit code is 0', async () => {
    const result = await call(ExecV3, input);
    const expected = 0;
    const actual = result.results[0]?.exitCode;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// sequential — bash: echo a; echo b  (absent op)
// ---------------------------------------------------------------------------

describe('sequential — echo a ; echo b', () => {
  const input = { intent: 'echo a then echo b', commands: [{ program: 'echo', args: ['a'] }, { program: 'echo', args: ['b'] }] };

  it('produces two results', async () => {
    const result = await call(ExecV3, input);
    const expected = 2;
    const actual = result.results.length;
    expect(actual).toBe(expected);
  });

  it('first result stdout is "a"', async () => {
    const result = await call(ExecV3, input);
    const expected = 'a';
    const actual = result.results[0]?.stdout;
    expect(actual).toBe(expected);
  });

  it('second result stdout is "b"', async () => {
    const result = await call(ExecV3, input);
    const expected = 'b';
    const actual = result.results[1]?.stdout;
    expect(actual).toBe(expected);
  });

  it('success is true', async () => {
    const result = await call(ExecV3, input);
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// && both run — bash: true && echo b
// ---------------------------------------------------------------------------

describe('&& both run — true && echo b', () => {
  const input = { intent: 'echo b only if true succeeds', commands: [{ program: 'true', op: '&&' as const }, { program: 'echo', args: ['b'] }] };

  it('produces two results', async () => {
    const result = await call(ExecV3, input);
    const expected = 2;
    const actual = result.results.length;
    expect(actual).toBe(expected);
  });

  it('second result stdout is "b"', async () => {
    const result = await call(ExecV3, input);
    const expected = 'b';
    const actual = result.results[1]?.stdout;
    expect(actual).toBe(expected);
  });

  it('success is true', async () => {
    const result = await call(ExecV3, input);
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// && short-circuit — bash: false && echo b
// ---------------------------------------------------------------------------

describe('&& short-circuit — false && echo b', () => {
  const input = { intent: 'echo b only if false succeeds', commands: [{ program: 'false', op: '&&' as const }, { program: 'echo', args: ['b'] }] };

  it('second slot is null (skipped)', async () => {
    const result = await call(ExecV3, input);
    const expected = null;
    const actual = result.results[1];
    expect(actual).toBe(expected);
  });

  it('first result exit code is 1', async () => {
    const result = await call(ExecV3, input);
    const expected = 1;
    const actual = result.results[0]?.exitCode;
    expect(actual).toBe(expected);
  });

  it('success is false', async () => {
    const result = await call(ExecV3, input);
    const expected = false;
    const actual = result.success;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// || fallback runs — bash: false || echo b
// ---------------------------------------------------------------------------

describe('|| fallback runs — false || echo b', () => {
  const input = { intent: 'echo b when false fails', commands: [{ program: 'false', op: '||' as const }, { program: 'echo', args: ['b'] }] };

  it('second result stdout is "b"', async () => {
    const result = await call(ExecV3, input);
    const expected = 'b';
    const actual = result.results[1]?.stdout;
    expect(actual).toBe(expected);
  });

  it('success is true (bash list status: b succeeded)', async () => {
    const result = await call(ExecV3, input);
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// || skip — bash: true || echo b
// ---------------------------------------------------------------------------

describe('|| skip — true || echo b', () => {
  const input = { intent: 'echo b only if true fails', commands: [{ program: 'true', op: '||' as const }, { program: 'echo', args: ['b'] }] };

  it('second slot is null (skipped)', async () => {
    const result = await call(ExecV3, input);
    const expected = null;
    const actual = result.results[1];
    expect(actual).toBe(expected);
  });

  it('success is true', async () => {
    const result = await call(ExecV3, input);
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// sequential after short-circuit — bash: false && echo b ; echo done
// ---------------------------------------------------------------------------

describe('sequential after short-circuit — false && echo b ; echo done', () => {
  const input = {
    intent: 'echo b if false succeeds, then always echo done',
    commands: [{ program: 'false', op: '&&' as const }, { program: 'echo', args: ['b'] }, { program: 'echo', args: ['done'] }],
  };

  it('middle slot is null (skipped)', async () => {
    const result = await call(ExecV3, input);
    const expected = null;
    const actual = result.results[1];
    expect(actual).toBe(expected);
  });

  it('third result stdout is "done" (sequential runs despite the skip)', async () => {
    const result = await call(ExecV3, input);
    const expected = 'done';
    const actual = result.results[2]?.stdout;
    expect(actual).toBe(expected);
  });

  it('success is true', async () => {
    const result = await call(ExecV3, input);
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// precedence — bash: false && echo b || echo c  ≡ (false && b) || c
// ---------------------------------------------------------------------------

describe('precedence — false && echo b || echo c', () => {
  const input = {
    intent: 'echo b if false succeeds, otherwise echo c',
    commands: [{ program: 'false', op: '&&' as const }, { program: 'echo', args: ['b'], op: '||' as const }, { program: 'echo', args: ['c'] }],
  };

  it('middle slot is null (b skipped)', async () => {
    const result = await call(ExecV3, input);
    const expected = null;
    const actual = result.results[1];
    expect(actual).toBe(expected);
  });

  it('third result stdout is "c"', async () => {
    const result = await call(ExecV3, input);
    const expected = 'c';
    const actual = result.results[2]?.stdout;
    expect(actual).toBe(expected);
  });

  it('success is true', async () => {
    const result = await call(ExecV3, input);
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// pipe 2-stage — bash: echo hello | cat
// ---------------------------------------------------------------------------

describe('pipe — echo hello | cat', () => {
  const input = { intent: 'pipe echo into cat', commands: [{ program: 'echo', args: ['hello'], op: '|' as const }, { program: 'cat' }] };

  it('produces one result per stage', async () => {
    const result = await call(ExecV3, input);
    const expected = 2;
    const actual = result.results.length;
    expect(actual).toBe(expected);
  });

  it('non-terminal stage stdout is empty (consumed by the pipe)', async () => {
    const result = await call(ExecV3, input);
    const expected = '';
    const actual = result.results[0]?.stdout;
    expect(actual).toBe(expected);
  });

  it('terminal stage carries the piped stdout', async () => {
    const result = await call(ExecV3, input);
    const expected = 'hello';
    const actual = result.results[1]?.stdout;
    expect(actual).toBe(expected);
  });

  it('success is true', async () => {
    const result = await call(ExecV3, input);
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// pipe 3-stage — bash: printf 'a\nb\nc\n' | grep b | wc -l
// ---------------------------------------------------------------------------

describe("pipe 3-stage — printf 'a\\nb\\nc\\n' | grep b | wc -l", () => {
  const input = {
    intent: 'count the lines matching b',
    commands: [{ program: 'printf', args: ['a\nb\nc\n'], op: '|' as const }, { program: 'grep', args: ['b'], op: '|' as const }, { program: 'wc', args: ['-l'] }],
  };

  it('produces three results', async () => {
    const result = await call(ExecV3, input);
    const expected = 3;
    const actual = result.results.length;
    expect(actual).toBe(expected);
  });

  it('terminal stdout is the line count 1', async () => {
    const result = await call(ExecV3, input);
    const actual = result.results[2]?.stdout;
    expect(actual).toMatch(/^\s*1$/);
  });

  it('success is true', async () => {
    const result = await call(ExecV3, input);
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// pipe no-pipefail — bash: sh -c 'echo done; exit 1' | cat
// ---------------------------------------------------------------------------

describe("pipe no-pipefail — sh -c 'echo done; exit 1' | cat", () => {
  const input = { intent: 'pipe a failing producer into cat', commands: [{ program: 'sh', args: ['-c', 'echo done; exit 1'], op: '|' as const }, { program: 'cat' }] };

  it('first stage exit code is 1', async () => {
    const result = await call(ExecV3, input);
    const expected = 1;
    const actual = result.results[0]?.exitCode;
    expect(actual).toBe(expected);
  });

  it('first stage stdout is empty (consumed by the pipe)', async () => {
    const result = await call(ExecV3, input);
    const expected = '';
    const actual = result.results[0]?.stdout;
    expect(actual).toBe(expected);
  });

  it('success is true (no pipefail: last stage = cat exit 0)', async () => {
    const result = await call(ExecV3, input);
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// stdin — bash: cat <<<'hello'
// ---------------------------------------------------------------------------

describe("stdin — cat <<<'hello'", () => {
  const input = { intent: 'feed a here-string into cat', commands: [{ program: 'cat', stdin: 'hello' }] };

  it('stdout is "hello"', async () => {
    const result = await call(ExecV3, input);
    const expected = 'hello';
    const actual = result.results[0]?.stdout;
    expect(actual).toBe(expected);
  });

  it('success is true', async () => {
    const result = await call(ExecV3, input);
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// stderr merge — bash: sh -c 'echo o; echo e >&2' 2>&1
// ---------------------------------------------------------------------------

describe("stderr merge — sh -c 'echo o; echo e >&2' with stderr &1", () => {
  const input = { intent: 'capture stdout and stderr together', commands: [{ program: 'sh', args: ['-c', 'echo o; echo e >&2'], redirect: { stderr: '&1' } }] };

  it('stdout contains the stdout line', async () => {
    const result = await call(ExecV3, input);
    const actual = result.results[0]?.stdout;
    expect(actual).toContain('o');
  });

  it('stdout contains the stderr line (merged)', async () => {
    const result = await call(ExecV3, input);
    const actual = result.results[0]?.stdout;
    expect(actual).toContain('e');
  });

  it('stderr is empty (merged into stdout)', async () => {
    const result = await call(ExecV3, input);
    const expected = '';
    const actual = result.results[0]?.stderr;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// stdout redirect — bash: echo hello > /dev/null
// ---------------------------------------------------------------------------

describe('stdout redirect — echo hello > /dev/null', () => {
  const input = { intent: 'discard echo output', commands: [{ program: 'echo', args: ['hello'], redirect: { stdout: '/dev/null' } }] };

  it('stdout is empty (consumed by the redirect)', async () => {
    const result = await call(ExecV3, input);
    const expected = '';
    const actual = result.results[0]?.stdout;
    expect(actual).toBe(expected);
  });

  it('success is true', async () => {
    const result = await call(ExecV3, input);
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// not found — bash: definitely-not-a-real-command-xyzzy
// ---------------------------------------------------------------------------

describe('not found — definitely-not-a-real-command-xyzzy', () => {
  const input = { intent: 'run a missing program', commands: [{ program: 'definitely-not-a-real-command-xyzzy' }] };

  it('exit code is 127', async () => {
    const result = await call(ExecV3, input);
    const expected = 127;
    const actual = result.results[0]?.exitCode;
    expect(actual).toBe(expected);
  });

  it('stderr contains "Command not found"', async () => {
    const result = await call(ExecV3, input);
    const actual = result.results[0]?.stderr;
    expect(actual).toContain('Command not found');
  });

  it('success is false', async () => {
    const result = await call(ExecV3, input);
    const expected = false;
    const actual = result.success;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// bad cwd — bash: (cwd /nonexistent) echo hello
// ---------------------------------------------------------------------------

describe('bad cwd — echo hello in a missing directory', () => {
  const input = { intent: 'run echo in a missing directory', commands: [{ program: 'echo', args: ['hello'], cwd: '/nonexistent/path/xyz123abc' }] };

  it('exit code is 126', async () => {
    const result = await call(ExecV3, input);
    const expected = 126;
    const actual = result.results[0]?.exitCode;
    expect(actual).toBe(expected);
  });

  it('stderr contains "Working directory not found"', async () => {
    const result = await call(ExecV3, input);
    const actual = result.results[0]?.stderr;
    expect(actual).toContain('Working directory not found');
  });
});

// ---------------------------------------------------------------------------
// timeout — bash: sleep 1  (timeout 100ms)
// ---------------------------------------------------------------------------

describe('timeout — sleep 1 killed at 100ms', () => {
  const input = { intent: 'time out a long sleep', timeout: 100, commands: [{ program: 'sleep', args: ['1'] }] };

  it('exit code is null (killed, not exited)', async () => {
    const result = await call(ExecV3, input);
    const expected = null;
    const actual = result.results[0]?.exitCode;
    expect(actual).toBe(expected);
  });

  it('signal is set', async () => {
    const result = await call(ExecV3, input);
    const expected = true;
    const actual = result.results[0]?.signal !== null;
    expect(actual).toBe(expected);
  });

  it('success is false', async () => {
    const result = await call(ExecV3, input);
    const expected = false;
    const actual = result.success;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// blocked — bash: rm -rf /tmp/whatever
// ---------------------------------------------------------------------------

describe('blocked — rm -rf /tmp/whatever', () => {
  const input = { intent: 'remove a directory', commands: [{ program: 'rm', args: ['-rf', '/tmp/whatever'] }] };

  it('success is false', async () => {
    const result = await call(ExecV3, input);
    const expected = false;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('stderr contains "BLOCKED"', async () => {
    const result = await call(ExecV3, input);
    const actual = result.results[0]?.stderr;
    expect(actual).toContain('BLOCKED');
  });

  it('stderr names the rule', async () => {
    const result = await call(ExecV3, input);
    const actual = result.results[0]?.stderr;
    expect(actual).toContain('no-destructive-commands');
  });
});

// ---------------------------------------------------------------------------
// stripAnsi default — node writing red ANSI
// ---------------------------------------------------------------------------

describe('stripAnsi default — strips ANSI codes', () => {
  const input = { intent: 'print coloured text', commands: [{ program: 'node', args: ['-e', "process.stdout.write('\\x1b[31mred\\x1b[0m')"] }] };

  it('stdout is "red" with ANSI stripped', async () => {
    const result = await call(ExecV3, input);
    const expected = 'red';
    const actual = result.results[0]?.stdout;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Validation rejects (parse fails before anything runs)
// ---------------------------------------------------------------------------

describe('validation — empty intent', () => {
  it('rejects an empty intent', () => {
    const expected = false;
    const actual = ExecV3InputSchema.safeParse({ intent: '', commands: [{ program: 'ls' }] }).success;
    expect(actual).toBe(expected);
  });
});

describe('validation — empty commands', () => {
  it('rejects an empty commands list', () => {
    const expected = false;
    const actual = ExecV3InputSchema.safeParse({ intent: 'x', commands: [] }).success;
    expect(actual).toBe(expected);
  });
});

describe('validation — empty program', () => {
  it('rejects an empty program', () => {
    const expected = false;
    const actual = ExecV3InputSchema.safeParse({ intent: 'x', commands: [{ program: '' }] }).success;
    expect(actual).toBe(expected);
  });
});

describe('validation — dangling operator', () => {
  it('rejects an op on the last command', () => {
    const expected = false;
    const actual = ExecV3InputSchema.safeParse({ intent: 'x', commands: [{ program: 'echo', op: '&&' }] }).success;
    expect(actual).toBe(expected);
  });
});

describe('validation — pipe with stdout redirect (R4)', () => {
  it('rejects stdout redirect on a piping command', () => {
    const expected = false;
    const actual = ExecV3InputSchema.safeParse({ intent: 'x', commands: [{ program: 'echo', op: '|', redirect: { stdout: '/tmp/x' } }, { program: 'cat' }] }).success;
    expect(actual).toBe(expected);
  });
});

describe('validation — stdin on a pipe target (NE2)', () => {
  it('rejects stdin on the target of a pipe', () => {
    const expected = false;
    const actual = ExecV3InputSchema.safeParse({ intent: 'x', commands: [{ program: 'echo', op: '|' }, { program: 'cat', stdin: 'x' }] }).success;
    expect(actual).toBe(expected);
  });
});
