import { fromLines, lines } from '../src/bytes.js';
import type { Operation, ToolV2, ToolV2Result } from '../src/types.js';

/** A fake's own stream is a buffer too. Left at Node's default it holds 16KB, so nothing a test
 *  configures downstream could hold a producer back and no bound would be visible. */
const FAKE_BUFFER_BYTES = 32;

/** A tool that yields fixed values and always succeeds. Erases its own `TIn` to `unknown`
 *  here, at the one place it's created — `ToolStage` holds `ToolV2<unknown>`, and a
 *  concrete `ToolV2<Record<...>, string>` is never safely assignable to that (TIn is
 *  contravariant), so every fake tool factory returns the erased shape directly. */
export function sourceTool(name: string, values: string[]): ToolV2<unknown> {
  return {
    name,
    operations: () => ['none'],
    run: (_input, _upstream, _stderr, _signal): ToolV2Result => ({ stdout: fromLines(values), success: () => true }),
  };
}

/** A tool whose success is driven directly by the test, and which records exactly what input
 *  it was actually invoked with — the way to prove reference resolution or Xargs injection
 *  reached the tool, not just that the engine claims it did. */
export function recordingTool(name: string, operation: Operation, succeed: boolean, calls: unknown[]): ToolV2<unknown> {
  return {
    name,
    operations: () => [operation],
    run: (input): ToolV2Result => {
      calls.push(input);
      return { stdout: fromLines(succeed ? ['ok'] : []), success: () => succeed };
    },
  };
}

/** Drains and re-yields exactly whatever it's handed as upstream (or nothing, if there is no
 *  upstream) — the same shape as real `cat`. This is what actually proves data moved (or
 *  didn't) through a join, rather than merely checking whether upstream was present. */
export function echoUpstreamTool(name: string, operation: Operation = 'none'): ToolV2<unknown> {
  return {
    name,
    operations: () => [operation],
    run: (_input, upstream, _stderr, _signal): ToolV2Result => ({
      stdout: fromLines(
        (async function* () {
          if (upstream == null) {
            return;
          }
          for await (const value of lines(upstream)) {
            yield String(value);
          }
        })(),
        FAKE_BUFFER_BYTES,
      ),
      success: () => true,
    }),
  };
}

/** A tool that only ever reads its own input, ignoring upstream entirely — the "dumb" target
 *  shape Xargs is meant to bridge into, matching an unmodified external/MCP tool. */
export function dumbFilesTool(name: string, operation: Operation): ToolV2<unknown> {
  return {
    name,
    operations: () => [operation],
    run: (input): ToolV2Result => {
      const files = (input as { files?: unknown[] }).files ?? [];
      return { stdout: fromLines(files.map((f) => `acted on: ${f}`)), success: () => true };
    },
  };
}

/** A tool that writes to stderr and optionally fails — for the surfacing-policy tests. */
export function stderrTool(name: string, succeed: boolean, stderrLines: string[]): ToolV2<unknown> {
  return {
    name,
    operations: () => ['none'],
    run: (_input, _upstream, stderr, _signal): ToolV2Result => {
      stderr.push(...stderrLines);
      return { stdout: fromLines(succeed ? ['ok'] : []), success: () => succeed };
    },
  };
}

/** A producer that records every value it actually got to yield, so a test can tell whether it
 *  ran to completion or was stopped early by whoever was reading it. */
export function countingSourceTool(name: string, values: string[], produced: string[]): ToolV2<unknown> {
  return {
    name,
    operations: () => ['none'],
    run: (): ToolV2Result => ({
      stdout: fromLines(
        (async function* () {
          for (const value of values) {
            produced.push(value);
            yield value;
          }
        })(),
        FAKE_BUFFER_BYTES,
      ),
      success: () => true,
    }),
  };
}

/** Reads only the first `count` values of its upstream and stops, the shape of `head`. */
export function takeTool(name: string, count: number): ToolV2<unknown> {
  return {
    name,
    operations: () => ['none'],
    run: (_input, upstream): ToolV2Result => ({
      stdout: fromLines(
        (async function* () {
          if (upstream == null) {
            return;
          }
          let taken = 0;
          for await (const value of lines(upstream)) {
            if (taken >= count) {
              return;
            }
            taken++;
            yield String(value);
          }
        })(),
        FAKE_BUFFER_BYTES,
      ),
      success: () => true,
    }),
  };
}

/** A producer that ends on a signal when its consumer stops reading, the way a real process killed
 *  by SIGPIPE does, and reports that signal rather than folding it into success. */
export function signallingSourceTool(name: string, values: string[]): ToolV2<unknown> {
  return {
    name,
    operations: () => ['none'],
    run: (): ToolV2Result => {
      let stopped = false;
      return {
        stdout: fromLines(
          (async function* () {
            try {
              for (const value of values) {
                yield value;
              }
            } finally {
              stopped = true;
            }
          })(),
          FAKE_BUFFER_BYTES,
        ),
        success: () => false,
        signal: () => (stopped ? 'SIGPIPE' : null),
      };
    },
  };
}

/** Reads one value from upstream and then throws, leaving its producer suspended mid-stream. */
export function throwingTool(name: string): ToolV2<unknown> {
  return {
    name,
    operations: () => ['none'],
    run: (_input, upstream): ToolV2Result => ({
      stdout: fromLines(
        (async function* (): AsyncGenerator<string, void, unknown> {
          if (upstream != null) {
            for await (const value of lines(upstream)) {
              yield String(value);
              break;
            }
          }
          throw new Error('stage exploded');
        })(),
        FAKE_BUFFER_BYTES,
      ),
      success: () => false,
    }),
  };
}

/** Records whether its stream was ever closed, which is what tells a real producer to stop. */
export function closeRecordingTool(name: string, closed: { value: boolean }): ToolV2<unknown> {
  return {
    name,
    operations: () => ['none'],
    run: (): ToolV2Result => ({
      stdout: fromLines(
        (async function* () {
          try {
            while (true) {
              yield 'value';
            }
          } finally {
            closed.value = true;
          }
        })(),
        FAKE_BUFFER_BYTES,
      ),
      success: () => true,
    }),
  };
}

/** Produces without end, recording every value it got out. How far it gets is the measure of how
 *  far a stage is allowed to run ahead of whoever is reading it.
 *
 *  It does stop eventually, at a count far above any buffer a test configures: a test proving that
 *  something bounds a producer should fail by seeing too many values, not by running until the
 *  suite gives up. */
const ENDLESS_SAFETY_STOP = 5_000;

export function endlessSourceTool(name: string, produced: string[], value = 'abcd'): ToolV2<unknown> {
  return {
    name,
    operations: () => ['none'],
    run: (): ToolV2Result => ({
      stdout: fromLines(
        (async function* () {
          for (let count = 0; count < ENDLESS_SAFETY_STOP; count++) {
            produced.push(value);
            yield value;
          }
        })(),
        FAKE_BUFFER_BYTES,
      ),
      success: () => true,
    }),
  };
}

/** Produces a fixed list, recording what it got out — for counting how far it ran. */
export function countedSourceTool(name: string, values: string[], produced: string[]): ToolV2<unknown> {
  return {
    name,
    operations: () => ['none'],
    run: (): ToolV2Result => ({
      stdout: fromLines(
        (async function* () {
          for (const value of values) {
            produced.push(value);
            yield value;
          }
        })(),
        FAKE_BUFFER_BYTES,
      ),
      success: () => true,
    }),
  };
}

/** A stage whose values are its side effects, the shape Delete has: one line out per thing done. */
export function sideEffectTool(name: string, operation: Operation, targets: string[], performed: string[]): ToolV2<unknown> {
  return {
    name,
    operations: () => [operation],
    run: (): ToolV2Result => ({
      stdout: fromLines(
        (async function* () {
          for (const target of targets) {
            performed.push(target);
            yield `done: ${target}`;
          }
        })(),
        FAKE_BUFFER_BYTES,
      ),
      success: () => true,
    }),
  };
}

/** Reads one value, waits for the test to release it, then reads the rest. Lets a test hold a
 *  producer at arm's length and see how far it ran while nobody was reading. */
export function pausingConsumerTool(name: string, release: Promise<void>, taken: string[]): ToolV2<unknown> {
  return {
    name,
    operations: () => ['none'],
    run: (_input, upstream): ToolV2Result => ({
      stdout: fromLines(
        (async function* () {
          if (upstream == null) {
            return;
          }
          let first = true;
          for await (const value of lines(upstream)) {
            taken.push(String(value));
            yield String(value);
            if (first) {
              first = false;
              await release;
            }
          }
        })(),
        FAKE_BUFFER_BYTES,
      ),
      success: () => true,
    }),
  };
}

/** Reads everything upstream gives it and yields it on, the shape of a stage that never stops
 *  asking for more. */
export function takeAllTool(name: string): ToolV2<unknown> {
  return {
    name,
    operations: () => ['none'],
    run: (_input, upstream): ToolV2Result => ({
      stdout: fromLines(
        (async function* () {
          if (upstream == null) {
            return;
          }
          for await (const value of lines(upstream)) {
            yield String(value);
          }
        })(),
        FAKE_BUFFER_BYTES,
      ),
      success: () => true,
    }),
  };
}
