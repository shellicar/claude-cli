import { Executor } from '@shellicar/exec-core';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { evaluate } from '../../src/ExecV3/engine';
import type { Command } from '../../src/ExecV3/types';
import { ExecV3, ExecV3InputSchema, passthroughEnvProvider } from '../../src/entry/ExecV3';
import { nodeFs } from '../../src/fs/nodeFs';

// Pipe-teardown tests — the hang, and the death of a producer whose consumer has gone.
//
// When a `|` consumer exits early (`find | head -1`), a producer that is never told its reader
// has gone blocks on backpressure forever. These tests hold the fixed behaviour: the run returns
// promptly, teardown reaches all the way up a multi-stage pipe, and every producer above the
// consumer is stopped. They go red if the pipe lifecycle regresses.
//
// The bound is the safety net: a hang must not stall the suite, so each run races a
// 2s timeout that aborts it. A timed-out run surfaces as `{ timedOut: true }`, which
// drives the assertions to a value that cannot match the expected one.

type ExecOutput = Awaited<ReturnType<typeof ExecV3.handler>>['textContent'];

type Bounded = { timedOut: true } | { timedOut: false; output: ExecOutput };

const BOUND_MS = 2000;

// What a torn-down producer reports is not fixed, so no test here asserts a particular signal.
// Node's stdio is a socketpair rather than a pipe, and a consumer that exits leaving unread bytes
// makes the kernel reset the connection: the producer's write then fails with ECONNRESET and it
// exits non-zero, where a clean close would have raised SIGPIPE. Both happen, and which one is a
// matter of timing. What holds either way is that the producer stopped and did not succeed.
function wasStopped(result: ExecOutput['results'][number]): boolean {
  return result != null && result.exitCode !== 0;
}

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

// The anchor bug report was reproduced with `find ~ -type f | head -n 1`; the mechanism it
// exercises (a producer torn down when its pipe consumer exits early) needs no filesystem
// access to prove — see 'broken-pipe death — yes | head -n 1' and 'multi-hop teardown — yes | cat |
// head -n 1' below, which cover the identical teardown path with no real fs contact.

// ---------------------------------------------------------------------------
// large-payload flush — bash: head -c N /dev/zero | cat
// ---------------------------------------------------------------------------
//
// A big producer through a `|` to a capturing sink must yield the whole payload with no
// truncated tail — resolution keys on the output stream draining, not on process exit.
// Fixed size, so the intermittent truncation is reproducible.

describe('large-payload flush — a big producer through a pipe', () => {
  const SIZE = 1_000_000;
  const input = {
    intent: 'stream a large payload through cat',
    commands: [{ program: 'head', args: ['-c', String(SIZE), '/dev/zero'], op: '|' as const }, { program: 'cat' }],
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

  it('tears down the first producer', async () => {
    const outcome = await runBounded(input);
    const expected = true;
    const actual = !outcome.timedOut && wasStopped(outcome.output.results[0]);
    expect(actual).toBe(expected);
  });

  it('tears down the middle stage', async () => {
    const outcome = await runBounded(input);
    const expected = true;
    const actual = !outcome.timedOut && wasStopped(outcome.output.results[1]);
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
// broken-pipe death — bash: yes | head -n 1
// ---------------------------------------------------------------------------
//
// The producer is stopped by the pipe breaking under it, and overall success follows the
// operator structure: the terminal stage's exit, not the producer's.

describe('broken-pipe death — yes | head -n 1', () => {
  const input = {
    intent: 'feed an endless producer into head',
    commands: [
      { program: 'yes', op: '|' as const },
      { program: 'head', args: ['-n', '1'] },
    ],
  };

  it('the torn-down producer is stopped', async () => {
    const outcome = await runBounded(input);
    const expected = true;
    const actual = !outcome.timedOut && wasStopped(outcome.output.results[0]);
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
// consumer that never starts — bash: yes | <a stage that cannot run>
// ---------------------------------------------------------------------------
//
// The consumer fails before it can read anything, so the pipe has no reader at all. The
// producer must take the same broken-pipe death it gets from a consumer that started and
// exited, rather than writing into nothing until the run times out.

describe('consumer that never starts — yes | a stage with a missing cwd', () => {
  const input = {
    intent: 'pipe an endless producer into a stage that cannot start',
    commands: [
      { program: 'yes', op: '|' as const },
      { program: 'cat', cwd: '/nonexistent/xyzzy-teardown' },
    ],
  };

  it('the producer is stopped rather than running on', async () => {
    const outcome = await runBounded(input);
    const expected = true;
    const actual = !outcome.timedOut && wasStopped(outcome.output.results[0]);
    expect(actual).toBe(expected);
  });

  it('the stage that could not start reports why', async () => {
    const outcome = await runBounded(input);
    const expected = true;
    const actual = outcome.timedOut ? false : (outcome.output.results[1]?.stderr.includes('Working directory not found') ?? false);
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// external cancel of a live pipe — bash: sleep 5 | cat, then ESC
// ---------------------------------------------------------------------------
//
// A cancel (ESC, or the default 30s timeout) that lands while every stage is still alive is
// a different path from a consumer exiting early, and it went untested for months while it
// hung: the stages died, but the run promise never settled, so the CLI wedged with nothing
// left running. `sleep 5 | cat` holds both stages open and moves no data, so the cancel
// lands on a live pipe. The requirement is only that the call comes back at all.

describe('external cancel — sleep 5 | cat cancelled mid-flight', () => {
  const input = {
    intent: 'hold a two-stage pipe open so a cancel lands while both stages are alive',
    commands: [{ program: 'sleep', args: ['5'], op: '|' as const }, { program: 'cat' }],
  };

  it('settles rather than hanging after every stage is killed', async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 100);
    const hung = Symbol('hung');
    const guard = new Promise<typeof hung>((resolve) => {
      setTimeout(() => resolve(hung), BOUND_MS);
    });

    try {
      // Cancelling makes the handler throw ToolCancelledError; either settlement proves it came
      // back, so only a hang can fail this.
      const settled = ExecV3.handler(ExecV3InputSchema.parse(input), controller.signal).then(
        () => 'settled' as const,
        () => 'settled' as const,
      );
      const outcome = await Promise.race([settled, guard]);
      const expected = 'settled';
      const actual = outcome === hung ? 'hung' : outcome;
      expect(actual).toBe(expected);
    } finally {
      clearTimeout(timer);
    }
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
// The proof that it happened early is the absence of SIGTERM. Had yes instead survived until
// the release-abort below, that abort would have killed it with SIGTERM. Any other outcome
// means the broken pipe stopped it when head exited, well before the pipeline (blocked on
// sleep) ended. The specific broken-pipe outcome is not asserted: see wasStopped above.

describe('middle-consumer exit — yes | head -n 1 | sleep 500', () => {
  const commands = [
    { program: 'yes', args: [], op: '|' },
    { program: 'head', args: ['-n', '1'], op: '|' },
    { program: 'sleep', args: ['500'] },
  ] satisfies Command[];

  it('tears down the first producer when the middle consumer exits', async () => {
    // The terminal sleep never exits, so release the pipeline with a short-delay abort;
    // yes was already torn down the instant head exited, long before this fires.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 500);
    const executor = new Executor();
    try {
      const output = await evaluate(commands, { cwd: process.cwd(), signal: controller.signal, executor, envProvider: passthroughEnvProvider, now: () => performance.now(), fs: nodeFs });
      const expected = true;
      const actual = output.results[0]?.signal !== 'SIGTERM';
      expect(actual).toBe(expected);
    } finally {
      clearTimeout(timer);
      executor[Symbol.dispose]();
    }
  });
});
