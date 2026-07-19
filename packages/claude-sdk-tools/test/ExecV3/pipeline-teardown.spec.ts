import { homedir } from 'node:os';
import { Executor } from '@shellicar/exec-core';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { evaluate } from '../../src/ExecV3/engine';
import type { Command } from '../../src/ExecV3/types';
import { ExecV3, ExecV3InputSchema, passthroughEnvProvider } from '../../src/entry/ExecV3';
import { nodeFs } from '../../src/fs/nodeFs';

// Pipe-teardown tests — the hang and the SIGPIPE death of a torn-down producer.
//
// When a `|` consumer exits early (`find | head -1`), the producer is never told its
// reader has gone and blocks on backpressure forever. These tests hold the behaviour we
// want: the run returns promptly, teardown cascades all the way up a multi-stage pipe,
// and a torn-down producer dies from SIGPIPE (the real broken-pipe signal). They FAIL today (the run hangs
// until the bound aborts it) and go green when the pipe lifecycle is fixed.
//
// The bound is the safety net: a hang must not stall the suite, so each run races a
// 2s timeout that aborts it. A timed-out run surfaces as `{ timedOut: true }`, which
// drives the assertions to a value that cannot match the expected one.

type ExecOutput = Awaited<ReturnType<typeof ExecV3.handler>>['textContent'];

type Bounded = { timedOut: true } | { timedOut: false; output: ExecOutput };

const BOUND_MS = 2000;

// Run ExecV3 with a hang guard: if it does not settle within BOUND_MS, abort it and
// report the timeout rather than letting the promise (and the suite) hang.
async function runBounded(input: z.input<typeof ExecV3InputSchema>): Promise<Bounded> {
  const parsed = ExecV3InputSchema.parse(input);
  const controller = new AbortController();
  const timedOut = Symbol('timed-out');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<typeof timedOut>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(timedOut);
    }, BOUND_MS);
  });

  const outcome = await Promise.race([ExecV3.handler(parsed, controller.signal), bound]);
  clearTimeout(timer);
  return outcome === timedOut ? { timedOut: true } : { timedOut: false, output: outcome.textContent };
}

// ---------------------------------------------------------------------------
// anchor — bash: find ~ -type f | head -n 1
// ---------------------------------------------------------------------------
//
// The reported repro: head reads one line and exits while find keeps walking the tree.
// Without upstream teardown, find blocks on backpressure and the run never returns.

describe('pipe early-consumer-exit — find | head -n 1', () => {
  const input = {
    intent: 'feed a directory walk into head',
    commands: [
      { program: 'find', args: [homedir(), '-type', 'f'], op: '|' as const },
      { program: 'head', args: ['-n', '1'] },
    ],
  };

  it('returns promptly rather than hanging', async () => {
    const outcome = await runBounded(input);
    const expected = false;
    const actual = outcome.timedOut;
    expect(actual).toBe(expected);
  });

  it('produces one result per stage', async () => {
    const outcome = await runBounded(input);
    const expected = 2;
    const actual = outcome.timedOut ? -1 : outcome.output.results.length;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// large-payload flush — bash: node -e "write N bytes" | cat
// ---------------------------------------------------------------------------
//
// A big producer through a `|` to a capturing sink must yield the whole payload with no
// truncated tail — resolution keys on the output stream draining, not on process exit.
// Fixed size, so the intermittent truncation is reproducible.

describe('large-payload flush — a big producer through a pipe', () => {
  const SIZE = 1_000_000;
  const input = {
    intent: 'stream a large payload through cat',
    commands: [{ program: 'node', args: ['-e', `process.stdout.write('x'.repeat(${SIZE}))`], op: '|' as const }, { program: 'cat' }],
  };

  it('captures the full payload with no truncated tail', async () => {
    const outcome = await runBounded(input);
    const expected = SIZE;
    const actual = outcome.timedOut ? -1 : outcome.output.results.at(-1)?.stdout.length;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// multi-hop cascade — bash: yes | cat | head -n 1
// ---------------------------------------------------------------------------
//
// head exits early; teardown must reach past cat all the way to yes, not just one hop.
// A two-stage case (yes | head) only proves one hop, so this uses three stages and
// asserts both upstream producers are torn down.

describe('multi-hop teardown — yes | cat | head -n 1', () => {
  const input = {
    intent: 'feed an endless producer through cat into head',
    commands: [
      { program: 'yes', op: '|' as const },
      { program: 'cat', op: '|' as const },
      { program: 'head', args: ['-n', '1'] },
    ],
  };

  it('returns promptly rather than hanging', async () => {
    const outcome = await runBounded(input);
    const expected = false;
    const actual = outcome.timedOut;
    expect(actual).toBe(expected);
  });

  it('tears down the first producer (dies from SIGPIPE)', async () => {
    const outcome = await runBounded(input);
    const expected = 'SIGPIPE';
    const actual = outcome.timedOut ? null : outcome.output.results[0]?.signal;
    expect(actual).toBe(expected);
  });

  it('tears down the middle stage (dies from SIGPIPE)', async () => {
    const outcome = await runBounded(input);
    const expected = 'SIGPIPE';
    const actual = outcome.timedOut ? null : outcome.output.results[1]?.signal;
    expect(actual).toBe(expected);
  });

  it('terminal stage exits 0', async () => {
    const outcome = await runBounded(input);
    const expected = 0;
    const actual = outcome.timedOut ? -1 : outcome.output.results[2]?.exitCode;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// SIGPIPE death — bash: yes | head -n 1
// ---------------------------------------------------------------------------
//
// A torn-down producer dies from SIGPIPE, the real broken-pipe signal; and overall
// success follows the operator structure — the terminal stage's exit, not the producer's.

describe('SIGPIPE death — yes | head -n 1', () => {
  const input = {
    intent: 'feed an endless producer into head',
    commands: [
      { program: 'yes', op: '|' as const },
      { program: 'head', args: ['-n', '1'] },
    ],
  };

  it('the torn-down producer dies from SIGPIPE', async () => {
    const outcome = await runBounded(input);
    const expected = 'SIGPIPE';
    const actual = outcome.timedOut ? null : outcome.output.results[0]?.signal;
    expect(actual).toBe(expected);
  });

  it('success follows the terminal stage (true)', async () => {
    const outcome = await runBounded(input);
    const expected = true;
    const actual = outcome.timedOut ? false : outcome.output.success;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// middle-consumer exit — bash: find ~ -type f | head -n 1 | sleep 500
// ---------------------------------------------------------------------------
//
// head is a MIDDLE stage; the terminal `sleep` never reads its stdin and never exits.
// The requirement: find must be torn down the instant head (its consumer) exits — not
// when the pipeline finishes. A never-exiting terminal holds the whole pipeline open
// (correct bash semantics: a pipeline waits on all members), so ExecV3.handler cannot
// return here — an external abort to release it makes the handler throw ToolCancelledError.
// So this drives `evaluate` directly and reads find's result.
//
// find dying from SIGPIPE is the proof: SIGPIPE comes only from the consumer-exit teardown
// path. Had find instead survived until the release-abort below, the external-cancel guard
// would leave it a raw SIGTERM, not SIGPIPE — so signal 'SIGPIPE' means head's exit tore it
// down, well before the pipeline (blocked on sleep) ended.

describe('middle-consumer exit — find | head -n 1 | sleep 500', () => {
  const commands = [
    { program: 'find', args: [homedir(), '-type', 'f'], op: '|' },
    { program: 'head', args: ['-n', '1'], op: '|' },
    { program: 'sleep', args: ['500'] },
  ] satisfies Command[];

  it('tears down the first producer when the middle consumer exits (dies from SIGPIPE)', async () => {
    // The terminal sleep never exits, so release the pipeline with a short-delay abort;
    // find was already torn down the instant head exited, long before this fires.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 500);
    const executor = new Executor();
    try {
      const output = await evaluate(commands, { cwd: homedir(), signal: controller.signal, executor, envProvider: passthroughEnvProvider, now: () => performance.now(), fs: nodeFs });
      const expected = 'SIGPIPE';
      const actual = output.results[0]?.signal;
      expect(actual).toBe(expected);
    } finally {
      clearTimeout(timer);
      executor[Symbol.dispose]();
    }
  });
});
