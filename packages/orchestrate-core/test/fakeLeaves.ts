import type { Leaf, LeafResult, Stream } from '../src/types.js';

async function* fromArray<T>(values: T[]): Stream<T> {
  for (const v of values) {
    yield v;
  }
}

/** A leaf that yields fixed values and always succeeds. Erases its own `TIn` to `unknown`
 *  here, at the one place it's created — `LeafStage` holds `Leaf<unknown, unknown>`, and a
 *  concrete `Leaf<Record<...>, string>` is never safely assignable to that (TIn is
 *  contravariant), so every fake leaf factory returns the erased shape directly. */
export function sourceLeaf(name: string, values: string[]): Leaf<unknown, unknown> {
  return {
    name,
    operation: 'none',
    run: (): LeafResult<string> => ({ stdout: fromArray(values), success: () => true }),
  };
}

/** A leaf whose success is driven directly by the test, and which records exactly what input
 *  it was actually invoked with — the way to prove reference resolution or Xargs injection
 *  reached the leaf, not just that the engine claims it did. */
export function recordingLeaf(name: string, operation: Leaf<unknown, unknown>['operation'], succeed: boolean, calls: unknown[]): Leaf<unknown, unknown> {
  return {
    name,
    operation,
    run: (input): LeafResult<string> => {
      calls.push(input);
      return { stdout: fromArray(succeed ? ['ok'] : []), success: () => succeed };
    },
  };
}

/** Drains and re-yields exactly whatever it's handed as upstream (or nothing, if there is no
 *  upstream) — the same shape as real `cat`. This is what actually proves data moved (or
 *  didn't) through a join, rather than merely checking whether upstream was present. */
export function echoUpstreamLeaf(name: string, operation: Leaf<unknown, unknown>['operation'] = 'none'): Leaf<unknown, unknown> {
  return {
    name,
    operation,
    run: (_input, upstream): LeafResult<string> => ({
      stdout: (async function* () {
        if (upstream == null) {
          return;
        }
        for await (const value of upstream) {
          yield String(value);
        }
      })(),
      success: () => true,
    }),
  };
}

/** A leaf that only ever reads its own input, ignoring upstream entirely — the "dumb" target
 *  shape Xargs is meant to bridge into, matching an unmodified external/MCP tool. */
export function dumbFilesLeaf(name: string, operation: Leaf<unknown, unknown>['operation']): Leaf<unknown, unknown> {
  return {
    name,
    operation,
    run: (input): LeafResult<string> => {
      const files = (input as { files?: unknown[] }).files ?? [];
      return { stdout: fromArray(files.map((f) => `acted on: ${f}`)), success: () => true };
    },
  };
}

/** A leaf that writes to stderr and optionally fails — for the surfacing-policy tests. */
export function stderrLeaf(name: string, succeed: boolean, stderrLines: string[]): Leaf<unknown, unknown> {
  return {
    name,
    operation: 'none',
    run: (_input, _upstream, stderr): LeafResult<string> => {
      stderr.push(...stderrLines);
      return { stdout: fromArray(succeed ? ['ok'] : []), success: () => succeed };
    },
  };
}
