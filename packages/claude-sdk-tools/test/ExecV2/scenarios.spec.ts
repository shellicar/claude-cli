import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { stripAnsi } from '../../src/Exec/stripAnsi';
import { createExecV2 } from '../../src/ExecV2/ExecV2';
import { executeTree } from '../../src/ExecV2/executeTree';
import { ExecV2InputSchema } from '../../src/ExecV2/schema';
import { FakeExecutor, shellLikeResponder } from '../FakeExecutor';
import { call } from '../helpers';
import { MemoryFileSystem } from '../MemoryFileSystem';

// V2 contract tests — one describe per scenario, one assertion per it.
// Source of truth: src/ExecV2/scenarios.md
//
// `run()` drives the tree walker (executeTree) directly, the same way the tool's handler
// does minus the rule check — these tests are about execution mechanics (pipes, chaining,
// redirects), never about which commands a safety rule blocks, so they never touch the rule
// validator at all. Only `B1` (below) deliberately keeps the real gated tool, since testing
// the block is its whole point.

const fs = new MemoryFileSystem();
const executor = new FakeExecutor(shellLikeResponder());
const ExecV2 = createExecV2(fs, executor);

// Helper: look up a result by its id. Throws if not found.
function byId<T extends { id: string }>(results: T[], id: string): T {
  const result = results.find((r) => r.id === id);
  if (result === undefined) {
    throw new Error(`No result with id '${id}' in [${results.map((r) => r.id).join(', ')}]`);
  }
  return result;
}

async function run(input: z.input<typeof ExecV2InputSchema>) {
  const parsed = ExecV2InputSchema.parse(input);
  const [results, aggregateExit] = await executeTree(parsed.pipeline, { cwd: process.cwd(), signal: undefined, executor, fs });
  const clean = parsed.stripAnsi ? stripAnsi : (s: string) => s;
  const finalResults = results.map((r) => ({ ...r, stdout: clean(r.stdout).trimEnd(), stderr: clean(r.stderr).trimEnd() }));
  const success = aggregateExit === 0;
  return { results: finalResults, success };
}

// ---------------------------------------------------------------------------
// S1 — echo hello
// ---------------------------------------------------------------------------

describe('S1 — echo hello', () => {
  it('success is true', async () => {
    const result = await run({
      intent: 'S1',
      pipeline: { id: 'a', program: 'echo', args: ['hello'] },
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('result a stdout is "hello"', async () => {
    const result = await run({
      intent: 'S1',
      pipeline: { id: 'a', program: 'echo', args: ['hello'] },
    });
    const expected = 'hello';
    const actual = byId(result.results, 'a').stdout;
    expect(actual).toBe(expected);
  });

  it('result a exit code is 0', async () => {
    const result = await run({
      intent: 'S1',
      pipeline: { id: 'a', program: 'echo', args: ['hello'] },
    });
    const expected = 0;
    const actual = byId(result.results, 'a').exitCode;
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
      pipeline: { id: 'a', program: 'sh', args: ['-c', 'exit 1'] },
    });
    const expected = false;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('result a exit code is 1', async () => {
    const result = await run({
      intent: 'S2',
      pipeline: { id: 'a', program: 'sh', args: ['-c', 'exit 1'] },
    });
    const expected = 1;
    const actual = byId(result.results, 'a').exitCode;
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
      pipeline: { op: ';', left: { id: 'a', program: 'echo', args: ['a'] }, right: { id: 'b', program: 'echo', args: ['b'] } },
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('produces two results', async () => {
    const result = await run({
      intent: 'C1',
      pipeline: { op: ';', left: { id: 'a', program: 'echo', args: ['a'] }, right: { id: 'b', program: 'echo', args: ['b'] } },
    });
    const expected = 2;
    const actual = result.results.length;
    expect(actual).toBe(expected);
  });

  it('result a stdout is "a"', async () => {
    const result = await run({
      intent: 'C1',
      pipeline: { op: ';', left: { id: 'a', program: 'echo', args: ['a'] }, right: { id: 'b', program: 'echo', args: ['b'] } },
    });
    const expected = 'a';
    const actual = byId(result.results, 'a').stdout;
    expect(actual).toBe(expected);
  });

  it('result b stdout is "b"', async () => {
    const result = await run({
      intent: 'C1',
      pipeline: { op: ';', left: { id: 'a', program: 'echo', args: ['a'] }, right: { id: 'b', program: 'echo', args: ['b'] } },
    });
    const expected = 'b';
    const actual = byId(result.results, 'b').stdout;
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
      pipeline: { op: ';', left: { id: 'a', program: 'sh', args: ['-c', 'exit 1'] }, right: { id: 'b', program: 'echo', args: ['b'] } },
    });
    const expected = false;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('produces two results (right runs unconditionally after ;)', async () => {
    const result = await run({
      intent: 'C2',
      pipeline: { op: ';', left: { id: 'a', program: 'sh', args: ['-c', 'exit 1'] }, right: { id: 'b', program: 'echo', args: ['b'] } },
    });
    const expected = 2;
    const actual = result.results.length;
    expect(actual).toBe(expected);
  });

  it('result a exit code is 1', async () => {
    const result = await run({
      intent: 'C2',
      pipeline: { op: ';', left: { id: 'a', program: 'sh', args: ['-c', 'exit 1'] }, right: { id: 'b', program: 'echo', args: ['b'] } },
    });
    const expected = 1;
    const actual = byId(result.results, 'a').exitCode;
    expect(actual).toBe(expected);
  });

  it('result b stdout is "b"', async () => {
    const result = await run({
      intent: 'C2',
      pipeline: { op: ';', left: { id: 'a', program: 'sh', args: ['-c', 'exit 1'] }, right: { id: 'b', program: 'echo', args: ['b'] } },
    });
    const expected = 'b';
    const actual = byId(result.results, 'b').stdout;
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
      pipeline: { op: '&&', left: { id: 'a', program: 'echo', args: ['a'] }, right: { id: 'b', program: 'echo', args: ['b'] } },
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('result a stdout is "a"', async () => {
    const result = await run({
      intent: 'A1',
      pipeline: { op: '&&', left: { id: 'a', program: 'echo', args: ['a'] }, right: { id: 'b', program: 'echo', args: ['b'] } },
    });
    const expected = 'a';
    const actual = byId(result.results, 'a').stdout;
    expect(actual).toBe(expected);
  });

  it('result b stdout is "b"', async () => {
    const result = await run({
      intent: 'A1',
      pipeline: { op: '&&', left: { id: 'a', program: 'echo', args: ['a'] }, right: { id: 'b', program: 'echo', args: ['b'] } },
    });
    const expected = 'b';
    const actual = byId(result.results, 'b').stdout;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// A2 — a command that exits 1 && echo b (second skipped)
// ---------------------------------------------------------------------------

describe('A2 — a command that exits 1 && echo b', () => {
  it('success is false', async () => {
    const result = await run({
      intent: 'A2',
      pipeline: { op: '&&', left: { id: 'a', program: 'sh', args: ['-c', 'exit 1'] }, right: { id: 'b', program: 'echo', args: ['b'] } },
    });
    const expected = false;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('produces one result (right never ran)', async () => {
    const result = await run({
      intent: 'A2',
      pipeline: { op: '&&', left: { id: 'a', program: 'sh', args: ['-c', 'exit 1'] }, right: { id: 'b', program: 'echo', args: ['b'] } },
    });
    const expected = 1;
    const actual = result.results.length;
    expect(actual).toBe(expected);
  });

  it('result a exit code is 1', async () => {
    const result = await run({
      intent: 'A2',
      pipeline: { op: '&&', left: { id: 'a', program: 'sh', args: ['-c', 'exit 1'] }, right: { id: 'b', program: 'echo', args: ['b'] } },
    });
    const expected = 1;
    const actual = byId(result.results, 'a').exitCode;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// O1 — true || echo b (first succeeds, second skipped) — V2 only
// ---------------------------------------------------------------------------

describe('O1 — true || echo b', () => {
  it('success is true', async () => {
    const result = await run({
      intent: 'O1',
      pipeline: { op: '||', left: { id: 'a', program: 'true' }, right: { id: 'b', program: 'echo', args: ['b'] } },
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('produces one result (right skipped because left succeeded)', async () => {
    const result = await run({
      intent: 'O1',
      pipeline: { op: '||', left: { id: 'a', program: 'true' }, right: { id: 'b', program: 'echo', args: ['b'] } },
    });
    const expected = 1;
    const actual = result.results.length;
    expect(actual).toBe(expected);
  });

  it('result a exit code is 0', async () => {
    const result = await run({
      intent: 'O1',
      pipeline: { op: '||', left: { id: 'a', program: 'true' }, right: { id: 'b', program: 'echo', args: ['b'] } },
    });
    const expected = 0;
    const actual = byId(result.results, 'a').exitCode;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// O2 — a command that exits 1 || echo b (first fails, second runs) — V2 only
// ---------------------------------------------------------------------------

describe('O2 — a command that exits 1 || echo b', () => {
  it('success is true (right succeeded)', async () => {
    const result = await run({
      intent: 'O2',
      pipeline: { op: '||', left: { id: 'a', program: 'sh', args: ['-c', 'exit 1'] }, right: { id: 'b', program: 'echo', args: ['b'] } },
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('produces two results', async () => {
    const result = await run({
      intent: 'O2',
      pipeline: { op: '||', left: { id: 'a', program: 'sh', args: ['-c', 'exit 1'] }, right: { id: 'b', program: 'echo', args: ['b'] } },
    });
    const expected = 2;
    const actual = result.results.length;
    expect(actual).toBe(expected);
  });

  it('result a exit code is 1', async () => {
    const result = await run({
      intent: 'O2',
      pipeline: { op: '||', left: { id: 'a', program: 'sh', args: ['-c', 'exit 1'] }, right: { id: 'b', program: 'echo', args: ['b'] } },
    });
    const expected = 1;
    const actual = byId(result.results, 'a').exitCode;
    expect(actual).toBe(expected);
  });

  it('result b stdout is "b"', async () => {
    const result = await run({
      intent: 'O2',
      pipeline: { op: '||', left: { id: 'a', program: 'sh', args: ['-c', 'exit 1'] }, right: { id: 'b', program: 'echo', args: ['b'] } },
    });
    const expected = 'b';
    const actual = byId(result.results, 'b').stdout;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// N1 — echo a & echo b (concurrent, both succeed)
// ---------------------------------------------------------------------------

describe('N1 — echo a & echo b (concurrent)', () => {
  it('success is true', async () => {
    const result = await run({
      intent: 'N1',
      pipeline: { op: '&', left: { id: 'a', program: 'echo', args: ['a'] }, right: { id: 'b', program: 'echo', args: ['b'] } },
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('produces two results in tree pre-order', async () => {
    const result = await run({
      intent: 'N1',
      pipeline: { op: '&', left: { id: 'a', program: 'echo', args: ['a'] }, right: { id: 'b', program: 'echo', args: ['b'] } },
    });
    const expected = 2;
    const actual = result.results.length;
    expect(actual).toBe(expected);
  });

  it('result a stdout is "a"', async () => {
    const result = await run({
      intent: 'N1',
      pipeline: { op: '&', left: { id: 'a', program: 'echo', args: ['a'] }, right: { id: 'b', program: 'echo', args: ['b'] } },
    });
    const expected = 'a';
    const actual = byId(result.results, 'a').stdout;
    expect(actual).toBe(expected);
  });

  it('result b stdout is "b"', async () => {
    const result = await run({
      intent: 'N1',
      pipeline: { op: '&', left: { id: 'a', program: 'echo', args: ['a'] }, right: { id: 'b', program: 'echo', args: ['b'] } },
    });
    const expected = 'b';
    const actual = byId(result.results, 'b').stdout;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// N2 — a command that exits 1 & echo b (concurrent, one fails)
// ---------------------------------------------------------------------------

describe('N2 — a command that exits 1 & echo b', () => {
  it('success is false', async () => {
    const result = await run({
      intent: 'N2',
      pipeline: { op: '&', left: { id: 'a', program: 'sh', args: ['-c', 'exit 1'] }, right: { id: 'b', program: 'echo', args: ['b'] } },
    });
    const expected = false;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('result a exit code is 1', async () => {
    const result = await run({
      intent: 'N2',
      pipeline: { op: '&', left: { id: 'a', program: 'sh', args: ['-c', 'exit 1'] }, right: { id: 'b', program: 'echo', args: ['b'] } },
    });
    const expected = 1;
    const actual = byId(result.results, 'a').exitCode;
    expect(actual).toBe(expected);
  });

  it('result b stdout is "b"', async () => {
    const result = await run({
      intent: 'N2',
      pipeline: { op: '&', left: { id: 'a', program: 'sh', args: ['-c', 'exit 1'] }, right: { id: 'b', program: 'echo', args: ['b'] } },
    });
    const expected = 'b';
    const actual = byId(result.results, 'b').stdout;
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
      pipeline: { op: '|', left: { id: 'a', program: 'echo', args: ['hello'] }, right: { id: 'b', program: 'cat' } },
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('produces two results (one per leaf)', async () => {
    const result = await run({
      intent: 'P1',
      pipeline: { op: '|', left: { id: 'a', program: 'echo', args: ['hello'] }, right: { id: 'b', program: 'cat' } },
    });
    const expected = 2;
    const actual = result.results.length;
    expect(actual).toBe(expected);
  });

  it('result a stdout is empty (consumed by pipe)', async () => {
    const result = await run({
      intent: 'P1',
      pipeline: { op: '|', left: { id: 'a', program: 'echo', args: ['hello'] }, right: { id: 'b', program: 'cat' } },
    });
    const expected = '';
    const actual = byId(result.results, 'a').stdout;
    expect(actual).toBe(expected);
  });

  it('result b stdout is "hello"', async () => {
    const result = await run({
      intent: 'P1',
      pipeline: { op: '|', left: { id: 'a', program: 'echo', args: ['hello'] }, right: { id: 'b', program: 'cat' } },
    });
    const expected = 'hello';
    const actual = byId(result.results, 'b').stdout;
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
      pipeline: {
        op: '|',
        left: { op: '|', left: { id: 'a', program: 'printf', args: ['a\nb\nc\n'] }, right: { id: 'b', program: 'grep', args: ['b'] } },
        right: { id: 'c', program: 'wc', args: ['-l'] },
      },
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('produces three results', async () => {
    const result = await run({
      intent: 'P2',
      pipeline: {
        op: '|',
        left: { op: '|', left: { id: 'a', program: 'printf', args: ['a\nb\nc\n'] }, right: { id: 'b', program: 'grep', args: ['b'] } },
        right: { id: 'c', program: 'wc', args: ['-l'] },
      },
    });
    const expected = 3;
    const actual = result.results.length;
    expect(actual).toBe(expected);
  });

  it('result a stdout is empty (consumed by pipe)', async () => {
    const result = await run({
      intent: 'P2',
      pipeline: {
        op: '|',
        left: { op: '|', left: { id: 'a', program: 'printf', args: ['a\nb\nc\n'] }, right: { id: 'b', program: 'grep', args: ['b'] } },
        right: { id: 'c', program: 'wc', args: ['-l'] },
      },
    });
    const expected = '';
    const actual = byId(result.results, 'a').stdout;
    expect(actual).toBe(expected);
  });

  it('result c stdout matches wc line count of 1', async () => {
    const result = await run({
      intent: 'P2',
      pipeline: {
        op: '|',
        left: { op: '|', left: { id: 'a', program: 'printf', args: ['a\nb\nc\n'] }, right: { id: 'b', program: 'grep', args: ['b'] } },
        right: { id: 'c', program: 'wc', args: ['-l'] },
      },
    });
    const actual = byId(result.results, 'c').stdout;
    expect(actual).toMatch(/^\s*1$/);
  });
});

// ---------------------------------------------------------------------------
// P3 — a failing producer | cat (V2 uses pipefail)
// ---------------------------------------------------------------------------

describe('P3 — a failing producer | cat', () => {
  it('success is false (pipefail: left stage exited non-zero)', async () => {
    const result = await run({
      intent: 'P3',
      pipeline: { op: '|', left: { id: 'a', program: 'sh', args: ['-c', 'echo done; exit 1'] }, right: { id: 'b', program: 'cat' } },
    });
    const expected = false;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('result a exit code is 1', async () => {
    const result = await run({
      intent: 'P3',
      pipeline: { op: '|', left: { id: 'a', program: 'sh', args: ['-c', 'echo done; exit 1'] }, right: { id: 'b', program: 'cat' } },
    });
    const expected = 1;
    const actual = byId(result.results, 'a').exitCode;
    expect(actual).toBe(expected);
  });

  it('result a stdout is empty (consumed by pipe)', async () => {
    const result = await run({
      intent: 'P3',
      pipeline: { op: '|', left: { id: 'a', program: 'sh', args: ['-c', 'echo done; exit 1'] }, right: { id: 'b', program: 'cat' } },
    });
    const expected = '';
    const actual = byId(result.results, 'a').stdout;
    expect(actual).toBe(expected);
  });

  it('result b stdout is "done"', async () => {
    const result = await run({
      intent: 'P3',
      pipeline: { op: '|', left: { id: 'a', program: 'sh', args: ['-c', 'echo done; exit 1'] }, right: { id: 'b', program: 'cat' } },
    });
    const expected = 'done';
    const actual = byId(result.results, 'b').stdout;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// M1 — a command that exits 1 && echo a || echo b — V2 only
// ---------------------------------------------------------------------------

describe('M1 — a command that exits 1 && echo a || echo b', () => {
  it('success is true (|| right branch succeeded)', async () => {
    const result = await run({
      intent: 'M1',
      pipeline: {
        op: '||',
        left: { op: '&&', left: { id: 'a', program: 'sh', args: ['-c', 'exit 1'] }, right: { id: 'b', program: 'echo', args: ['a'] } },
        right: { id: 'c', program: 'echo', args: ['b'] },
      },
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('produces two results (a ran, b skipped by &&, c ran via ||)', async () => {
    const result = await run({
      intent: 'M1',
      pipeline: {
        op: '||',
        left: { op: '&&', left: { id: 'a', program: 'sh', args: ['-c', 'exit 1'] }, right: { id: 'b', program: 'echo', args: ['a'] } },
        right: { id: 'c', program: 'echo', args: ['b'] },
      },
    });
    const expected = 2;
    const actual = result.results.length;
    expect(actual).toBe(expected);
  });

  it('result a exit code is 1', async () => {
    const result = await run({
      intent: 'M1',
      pipeline: {
        op: '||',
        left: { op: '&&', left: { id: 'a', program: 'sh', args: ['-c', 'exit 1'] }, right: { id: 'b', program: 'echo', args: ['a'] } },
        right: { id: 'c', program: 'echo', args: ['b'] },
      },
    });
    const expected = 1;
    const actual = byId(result.results, 'a').exitCode;
    expect(actual).toBe(expected);
  });

  it('result c stdout is "b"', async () => {
    const result = await run({
      intent: 'M1',
      pipeline: {
        op: '||',
        left: { op: '&&', left: { id: 'a', program: 'sh', args: ['-c', 'exit 1'] }, right: { id: 'b', program: 'echo', args: ['a'] } },
        right: { id: 'c', program: 'echo', args: ['b'] },
      },
    });
    const expected = 'b';
    const actual = byId(result.results, 'c').stdout;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// M2 — echo a; a command that exits 1 && echo b — V2 only
// ---------------------------------------------------------------------------

describe('M2 — echo a; a command that exits 1 && echo b', () => {
  it('success is false', async () => {
    const result = await run({
      intent: 'M2',
      pipeline: {
        op: ';',
        left: { id: 'a', program: 'echo', args: ['a'] },
        right: { op: '&&', left: { id: 'b', program: 'sh', args: ['-c', 'exit 1'] }, right: { id: 'c', program: 'echo', args: ['b'] } },
      },
    });
    const expected = false;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('produces two results (a ran, b ran and failed, c skipped)', async () => {
    const result = await run({
      intent: 'M2',
      pipeline: {
        op: ';',
        left: { id: 'a', program: 'echo', args: ['a'] },
        right: { op: '&&', left: { id: 'b', program: 'sh', args: ['-c', 'exit 1'] }, right: { id: 'c', program: 'echo', args: ['b'] } },
      },
    });
    const expected = 2;
    const actual = result.results.length;
    expect(actual).toBe(expected);
  });

  it('result a stdout is "a"', async () => {
    const result = await run({
      intent: 'M2',
      pipeline: {
        op: ';',
        left: { id: 'a', program: 'echo', args: ['a'] },
        right: { op: '&&', left: { id: 'b', program: 'sh', args: ['-c', 'exit 1'] }, right: { id: 'c', program: 'echo', args: ['b'] } },
      },
    });
    const expected = 'a';
    const actual = byId(result.results, 'a').stdout;
    expect(actual).toBe(expected);
  });

  it('result b exit code is 1', async () => {
    const result = await run({
      intent: 'M2',
      pipeline: {
        op: ';',
        left: { id: 'a', program: 'echo', args: ['a'] },
        right: { op: '&&', left: { id: 'b', program: 'sh', args: ['-c', 'exit 1'] }, right: { id: 'c', program: 'echo', args: ['b'] } },
      },
    });
    const expected = 1;
    const actual = byId(result.results, 'b').exitCode;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// M3 — (echo a && echo b) | wc -l — V2 only
// ---------------------------------------------------------------------------

describe('M3 — (echo a && echo b) | wc -l', () => {
  it('success is true', async () => {
    const result = await run({
      intent: 'M3',
      pipeline: {
        op: '|',
        left: { op: '&&', left: { id: 'a', program: 'echo', args: ['a'] }, right: { id: 'b', program: 'echo', args: ['b'] } },
        right: { id: 'c', program: 'wc', args: ['-l'] },
      },
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('produces three results', async () => {
    const result = await run({
      intent: 'M3',
      pipeline: {
        op: '|',
        left: { op: '&&', left: { id: 'a', program: 'echo', args: ['a'] }, right: { id: 'b', program: 'echo', args: ['b'] } },
        right: { id: 'c', program: 'wc', args: ['-l'] },
      },
    });
    const expected = 3;
    const actual = result.results.length;
    expect(actual).toBe(expected);
  });

  it('result a stdout is empty (consumed by pipe)', async () => {
    const result = await run({
      intent: 'M3',
      pipeline: {
        op: '|',
        left: { op: '&&', left: { id: 'a', program: 'echo', args: ['a'] }, right: { id: 'b', program: 'echo', args: ['b'] } },
        right: { id: 'c', program: 'wc', args: ['-l'] },
      },
    });
    const expected = '';
    const actual = byId(result.results, 'a').stdout;
    expect(actual).toBe(expected);
  });

  it('result b stdout is empty (consumed by pipe)', async () => {
    const result = await run({
      intent: 'M3',
      pipeline: {
        op: '|',
        left: { op: '&&', left: { id: 'a', program: 'echo', args: ['a'] }, right: { id: 'b', program: 'echo', args: ['b'] } },
        right: { id: 'c', program: 'wc', args: ['-l'] },
      },
    });
    const expected = '';
    const actual = byId(result.results, 'b').stdout;
    expect(actual).toBe(expected);
  });

  it('result c stdout matches wc line count of 2', async () => {
    const result = await run({
      intent: 'M3',
      pipeline: {
        op: '|',
        left: { op: '&&', left: { id: 'a', program: 'echo', args: ['a'] }, right: { id: 'b', program: 'echo', args: ['b'] } },
        right: { id: 'c', program: 'wc', args: ['-l'] },
      },
    });
    const actual = byId(result.results, 'c').stdout;
    expect(actual).toMatch(/^\s*2$/);
  });
});

// ---------------------------------------------------------------------------
// F1 — cat <<<'hello'
// ---------------------------------------------------------------------------

describe("F1 — cat <<<'hello'", () => {
  it('success is true', async () => {
    const result = await run({
      intent: 'F1',
      pipeline: { id: 'a', program: 'cat', stdin: 'hello' },
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('result a stdout is "hello"', async () => {
    const result = await run({
      intent: 'F1',
      pipeline: { id: 'a', program: 'cat', stdin: 'hello' },
    });
    const expected = 'hello';
    const actual = byId(result.results, 'a').stdout;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// F2 — a command writing both stdout and stderr, merged | cat
// ---------------------------------------------------------------------------

describe('F2 — stdout and stderr merged | cat', () => {
  it('result b stdout contains "out"', async () => {
    const result = await run({
      intent: 'F2',
      pipeline: {
        op: '|',
        left: { id: 'a', program: 'sh', args: ['-c', 'echo out; echo err >&2'], merge_stderr: true },
        right: { id: 'b', program: 'cat' },
      },
    });
    const actual = byId(result.results, 'b').stdout;
    expect(actual).toContain('out');
  });

  it('result b stdout contains "err"', async () => {
    const result = await run({
      intent: 'F2',
      pipeline: {
        op: '|',
        left: { id: 'a', program: 'sh', args: ['-c', 'echo out; echo err >&2'], merge_stderr: true },
        right: { id: 'b', program: 'cat' },
      },
    });
    const actual = byId(result.results, 'b').stdout;
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
      pipeline: { id: 'a', program: 'echo', args: ['hello'], redirect: { path: '/cwd/discard.txt', stream: 'stdout' } },
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('result a stdout is empty (consumed by redirect)', async () => {
    const result = await run({
      intent: 'R1',
      pipeline: { id: 'a', program: 'echo', args: ['hello'], redirect: { path: '/cwd/discard.txt', stream: 'stdout' } },
    });
    const expected = '';
    const actual = byId(result.results, 'a').stdout;
    expect(actual).toBe(expected);
  });

  it('result a exit code is 0', async () => {
    const result = await run({
      intent: 'R1',
      pipeline: { id: 'a', program: 'echo', args: ['hello'], redirect: { path: '/cwd/discard.txt', stream: 'stdout' } },
    });
    const expected = 0;
    const actual = byId(result.results, 'a').exitCode;
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
      pipeline: { id: 'a', program: 'sh', args: ['-c', 'echo err >&2'], redirect: { path: '/cwd/discard.txt', stream: 'stderr' } },
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('result a stderr is empty (consumed by redirect)', async () => {
    const result = await run({
      intent: 'R2',
      pipeline: { id: 'a', program: 'sh', args: ['-c', 'echo err >&2'], redirect: { path: '/cwd/discard.txt', stream: 'stderr' } },
    });
    const expected = '';
    const actual = byId(result.results, 'a').stderr;
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
      pipeline: { op: '|', left: { id: 'a', program: 'echo', args: ['hello'] }, right: { id: 'b', program: 'cat', redirect: { path: '/cwd/discard.txt', stream: 'stdout' } } },
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('result a stdout is empty (consumed by pipe)', async () => {
    const result = await run({
      intent: 'R3',
      pipeline: { op: '|', left: { id: 'a', program: 'echo', args: ['hello'] }, right: { id: 'b', program: 'cat', redirect: { path: '/cwd/discard.txt', stream: 'stdout' } } },
    });
    const expected = '';
    const actual = byId(result.results, 'a').stdout;
    expect(actual).toBe(expected);
  });

  it('result b stdout is empty (consumed by redirect)', async () => {
    const result = await run({
      intent: 'R3',
      pipeline: { op: '|', left: { id: 'a', program: 'echo', args: ['hello'] }, right: { id: 'b', program: 'cat', redirect: { path: '/cwd/discard.txt', stream: 'stdout' } } },
    });
    const expected = '';
    const actual = byId(result.results, 'b').stdout;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// R4 — echo hello > (redirect) | cat (schema rejects redirect on pipe-source)
// ---------------------------------------------------------------------------

describe('R4 — echo hello > (redirect) | cat (V2 rejects redirect on pipe-source)', () => {
  it('rejects with an error mentioning redirect and pipe', () => {
    const actual = () =>
      ExecV2InputSchema.parse({
        intent: 'R4',
        pipeline: {
          op: '|',
          left: { id: 'a', program: 'echo', args: ['hello'], redirect: { path: '/cwd/discard.txt', stream: 'stdout' } },
          right: { id: 'b', program: 'cat' },
        },
      });
    expect(actual).toThrow(/redirect.*pipe|pipe.*redirect/i);
  });
});

// ---------------------------------------------------------------------------
// R5 — echo "hello world" | tee (redirect) | cat
// ---------------------------------------------------------------------------

describe('R5 — echo "hello world" | tee (redirect) | cat', () => {
  it('success is true', async () => {
    const result = await run({
      intent: 'R5',
      pipeline: {
        op: '|',
        left: { op: '|', left: { id: 'a', program: 'echo', args: ['hello world'] }, right: { id: 'b', program: 'tee', args: ['/cwd/discard.txt'] } },
        right: { id: 'c', program: 'cat' },
      },
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('result a stdout is empty (consumed by pipe)', async () => {
    const result = await run({
      intent: 'R5',
      pipeline: {
        op: '|',
        left: { op: '|', left: { id: 'a', program: 'echo', args: ['hello world'] }, right: { id: 'b', program: 'tee', args: ['/cwd/discard.txt'] } },
        right: { id: 'c', program: 'cat' },
      },
    });
    const expected = '';
    const actual = byId(result.results, 'a').stdout;
    expect(actual).toBe(expected);
  });

  it('result b stdout is empty (its stdout was consumed by the next pipe stage)', async () => {
    const result = await run({
      intent: 'R5',
      pipeline: {
        op: '|',
        left: { op: '|', left: { id: 'a', program: 'echo', args: ['hello world'] }, right: { id: 'b', program: 'tee', args: ['/cwd/discard.txt'] } },
        right: { id: 'c', program: 'cat' },
      },
    });
    const expected = '';
    const actual = byId(result.results, 'b').stdout;
    expect(actual).toBe(expected);
  });

  it('result c stdout is "hello world"', async () => {
    const result = await run({
      intent: 'R5',
      pipeline: {
        op: '|',
        left: { op: '|', left: { id: 'a', program: 'echo', args: ['hello world'] }, right: { id: 'b', program: 'tee', args: ['/cwd/discard.txt'] } },
        right: { id: 'c', program: 'cat' },
      },
    });
    const expected = 'hello world';
    const actual = byId(result.results, 'c').stdout;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// NE1 — bare & with no right operand (schema rejection)
// ---------------------------------------------------------------------------

describe('NE1 — op "&" with no right field (missing required right)', () => {
  it('rejects with a schema error mentioning "right"', () => {
    // biome-ignore lint/suspicious/noExplicitAny: intentionally invalid input to verify schema rejection
    const actual = () => ExecV2InputSchema.parse({ intent: 'NE1', pipeline: { op: '&', left: { id: 'a', program: 'echo', args: ['a'] } } } as any);
    expect(actual).toThrow(/right/i);
  });
});

// ---------------------------------------------------------------------------
// NE2 — stdin on a right-of-pipe Command (schema rejection)
// ---------------------------------------------------------------------------

describe('NE2 — echo hello | cat (stdin on right-of-pipe rejected by V2)', () => {
  it('rejects with an error mentioning stdin and pipe', () => {
    const actual = () =>
      ExecV2InputSchema.parse({
        intent: 'NE2',
        pipeline: {
          op: '|',
          left: { id: 'a', program: 'echo', args: ['hello'] },
          right: { id: 'b', program: 'cat', stdin: 'ignored' },
        },
      });
    expect(actual).toThrow(/stdin.*pipe|pipe.*stdin/i);
  });
});

// ---------------------------------------------------------------------------
// B1 — rm -rf /tmp/whatever (blocked command)
// ---------------------------------------------------------------------------
//
// The one describe in this file that deliberately keeps the real gated tool: testing
// that a rule blocks a command is the whole point here, unlike everything above.

describe('B1 — rm -rf /tmp/whatever (blocked)', () => {
  it('success is false', async () => {
    const result = await call(ExecV2, {
      intent: 'B1',
      pipeline: { id: 'a', program: 'rm', args: ['-rf', '/tmp/whatever'] },
    });
    const expected = false;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('stderr contains "BLOCKED"', async () => {
    const result = await call(ExecV2, {
      intent: 'B1',
      pipeline: { id: 'a', program: 'rm', args: ['-rf', '/tmp/whatever'] },
    });
    const actual = result.results[0].stderr;
    expect(actual).toContain('BLOCKED');
  });

  it('stderr names the rule', async () => {
    const result = await call(ExecV2, {
      intent: 'B1',
      pipeline: { id: 'a', program: 'rm', args: ['-rf', '/tmp/whatever'] },
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
      pipeline: { id: 'a', program: 'definitely-not-a-real-command-xyzzy-abc' },
    });
    const expected = false;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('result a exit code is 127', async () => {
    const result = await run({
      intent: 'ER1',
      pipeline: { id: 'a', program: 'definitely-not-a-real-command-xyzzy-abc' },
    });
    const expected = 127;
    const actual = byId(result.results, 'a').exitCode;
    expect(actual).toBe(expected);
  });

  it('result a stderr contains "Command not found"', async () => {
    const result = await run({
      intent: 'ER1',
      pipeline: { id: 'a', program: 'definitely-not-a-real-command-xyzzy-abc' },
    });
    const actual = byId(result.results, 'a').stderr;
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
      pipeline: { id: 'a', program: 'echo', args: ['hello'], cwd: '/nonexistent/path/xyz123abc' },
    });
    const expected = false;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('result a exit code is 126', async () => {
    const result = await run({
      intent: 'ER2',
      pipeline: { id: 'a', program: 'echo', args: ['hello'], cwd: '/nonexistent/path/xyz123abc' },
    });
    const expected = 126;
    const actual = byId(result.results, 'a').exitCode;
    expect(actual).toBe(expected);
  });

  it('result a stderr contains "Working directory not found"', async () => {
    const result = await run({
      intent: 'ER2',
      pipeline: { id: 'a', program: 'echo', args: ['hello'], cwd: '/nonexistent/path/xyz123abc' },
    });
    const actual = byId(result.results, 'a').stderr;
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
      pipeline: { op: '|', left: { id: 'a', program: 'definitely-not-a-real-command-xyzzy-abc' }, right: { id: 'b', program: 'cat' } },
    });
    const expected = false;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('result a exit code is 127', async () => {
    const result = await run({
      intent: 'ER3',
      pipeline: { op: '|', left: { id: 'a', program: 'definitely-not-a-real-command-xyzzy-abc' }, right: { id: 'b', program: 'cat' } },
    });
    const expected = 127;
    const actual = byId(result.results, 'a').exitCode;
    expect(actual).toBe(expected);
  });

  it('result a stderr contains "Command not found"', async () => {
    const result = await run({
      intent: 'ER3',
      pipeline: { op: '|', left: { id: 'a', program: 'definitely-not-a-real-command-xyzzy-abc' }, right: { id: 'b', program: 'cat' } },
    });
    const actual = byId(result.results, 'a').stderr;
    expect(actual).toContain('Command not found');
  });

  it('result b exit code is 0 (cat ran with empty stdin)', async () => {
    const result = await run({
      intent: 'ER3',
      pipeline: { op: '|', left: { id: 'a', program: 'definitely-not-a-real-command-xyzzy-abc' }, right: { id: 'b', program: 'cat' } },
    });
    const expected = 0;
    const actual = byId(result.results, 'b').exitCode;
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
      pipeline: { id: 'a', program: 'node', args: ['-e', 'process.stdout.write(process.cwd())'], cwd: '/' },
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('result a stdout is "/"', async () => {
    const result = await run({
      intent: 'CF1',
      pipeline: { id: 'a', program: 'node', args: ['-e', 'process.stdout.write(process.cwd())'], cwd: '/' },
    });
    const expected = '/';
    const actual = byId(result.results, 'a').stdout;
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
      pipeline: { id: 'a', program: 'node', args: ['-e', "process.stdout.write(process.env['EXEC_V2_TEST_VAR'] ?? 'missing')"], env: { EXEC_V2_TEST_VAR: 'hello' } },
    });
    const expected = true;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('result a stdout is "hello"', async () => {
    const result = await run({
      intent: 'CF2',
      pipeline: { id: 'a', program: 'node', args: ['-e', "process.stdout.write(process.env['EXEC_V2_TEST_VAR'] ?? 'missing')"], env: { EXEC_V2_TEST_VAR: 'hello' } },
    });
    const expected = 'hello';
    const actual = byId(result.results, 'a').stdout;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// TO1 — a killed status flows through to the result shape
// ---------------------------------------------------------------------------
//
// FakeExecutor never really sleeps, so this doesn't prove a real timeout kills a real
// process — that's test/integration/timeout.spec.ts (real spawn, real sleep, real kill;
// covers ExecV3, but the wiring is shared via execSignal, so ExecV2 doesn't need its own).
// This only proves an already-killed status (exitCode null, a signal set) is reported
// correctly by the tool — so, unlike the mechanics tests above, it does need the real
// tool (for its timeout wiring), not the bare tree walker.

describe('TO1 — a killed status is reported correctly (not a real timeout — see integration)', () => {
  const slowExecV2 = createExecV2(new MemoryFileSystem(), new FakeExecutor(() => ({ exitCode: null, signal: 'SIGTERM' })));

  it('success is false', async () => {
    const result = await call(slowExecV2, {
      intent: 'TO1',
      timeout: 100,
      pipeline: { id: 'a', program: 'sleep', args: ['1'] },
    });
    const expected = false;
    const actual = result.success;
    expect(actual).toBe(expected);
  });

  it('result a exit code is null (killed)', async () => {
    const result = await call(slowExecV2, {
      intent: 'TO1',
      timeout: 100,
      pipeline: { id: 'a', program: 'sleep', args: ['1'] },
    });
    const expected = null;
    const actual = byId(result.results, 'a').exitCode;
    expect(actual).toBe(expected);
  });

  it('result a signal is set', async () => {
    const result = await call(slowExecV2, {
      intent: 'TO1',
      timeout: 100,
      pipeline: { id: 'a', program: 'sleep', args: ['1'] },
    });
    const expected = true;
    const actual = byId(result.results, 'a').signal !== null;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// SA1-default — stripAnsi: true (default) strips ANSI codes
// ---------------------------------------------------------------------------

describe('SA1-default — stripAnsi true (default) strips ANSI codes', () => {
  it('result a stdout is "red" with ANSI stripped', async () => {
    const result = await run({
      intent: 'SA1-default',
      pipeline: { id: 'a', program: 'node', args: ['-e', "process.stdout.write('\\x1b[31mred\\x1b[0m')"] },
    });
    const expected = 'red';
    const actual = byId(result.results, 'a').stdout;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// SA1-preserved — stripAnsi: false preserves ANSI codes
// ---------------------------------------------------------------------------

describe('SA1-preserved — stripAnsi false preserves ANSI codes', () => {
  it('result a stdout contains ANSI escape sequence', async () => {
    const result = await run({
      intent: 'SA1-preserved',
      stripAnsi: false,
      pipeline: { id: 'a', program: 'node', args: ['-e', "process.stdout.write('\\x1b[31mred\\x1b[0m')"] },
    });
    const expected = true;
    const actual = byId(result.results, 'a').stdout.includes('\x1b[');
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// NE3 — group on the right of a pipe (schema rejection)
// ---------------------------------------------------------------------------

describe('NE3 — op "|" with a group (&&) on the right (schema rejects group-as-pipe-consumer)', () => {
  it('rejects with an error mentioning pipe and command', () => {
    const actual = () =>
      ExecV2InputSchema.parse({
        intent: 'NE3',
        pipeline: {
          op: '|',
          left: { id: 'a', program: 'echo', args: ['hello'] },
          right: {
            op: '&&',
            left: { id: 'b', program: 'cat' },
            right: { id: 'c', program: 'wc', args: ['-l'] },
          },
        },
      });
    expect(actual).toThrow(/pipe|command/i);
  });
});
