import type { Stream, ToolV2, ToolV2Result } from '../src/types.js';

async function* fromArray<T>(values: T[]): Stream<T> {
  for (const v of values) {
    yield v;
  }
}

/** A tool that yields fixed values and always succeeds. Erases its own `TIn` to `unknown`
 *  here, at the one place it's created — `ToolStage` holds `ToolV2<unknown, unknown>`, and a
 *  concrete `ToolV2<Record<...>, string>` is never safely assignable to that (TIn is
 *  contravariant), so every fake tool factory returns the erased shape directly. */
export function sourceTool(name: string, values: string[]): ToolV2<unknown, unknown> {
  return {
    name,
    operation: 'none',
    run: (_input, _upstream, _stderr, _signal): ToolV2Result<string> => ({ stdout: fromArray(values), success: () => true }),
  };
}

/** A tool whose success is driven directly by the test, and which records exactly what input
 *  it was actually invoked with — the way to prove reference resolution or Xargs injection
 *  reached the tool, not just that the engine claims it did. */
export function recordingTool(name: string, operation: ToolV2<unknown, unknown>['operation'], succeed: boolean, calls: unknown[]): ToolV2<unknown, unknown> {
  return {
    name,
    operation,
    run: (input): ToolV2Result<string> => {
      calls.push(input);
      return { stdout: fromArray(succeed ? ['ok'] : []), success: () => succeed };
    },
  };
}

/** Drains and re-yields exactly whatever it's handed as upstream (or nothing, if there is no
 *  upstream) — the same shape as real `cat`. This is what actually proves data moved (or
 *  didn't) through a join, rather than merely checking whether upstream was present. */
export function echoUpstreamTool(name: string, operation: ToolV2<unknown, unknown>['operation'] = 'none'): ToolV2<unknown, unknown> {
  return {
    name,
    operation,
    run: (_input, upstream, _stderr, _signal): ToolV2Result<string> => ({
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

/** A tool that only ever reads its own input, ignoring upstream entirely — the "dumb" target
 *  shape Xargs is meant to bridge into, matching an unmodified external/MCP tool. */
export function dumbFilesTool(name: string, operation: ToolV2<unknown, unknown>['operation']): ToolV2<unknown, unknown> {
  return {
    name,
    operation,
    run: (input): ToolV2Result<string> => {
      const files = (input as { files?: unknown[] }).files ?? [];
      return { stdout: fromArray(files.map((f) => `acted on: ${f}`)), success: () => true };
    },
  };
}

/** A tool that writes to stderr and optionally fails — for the surfacing-policy tests. */
export function stderrTool(name: string, succeed: boolean, stderrLines: string[]): ToolV2<unknown, unknown> {
  return {
    name,
    operation: 'none',
    run: (_input, _upstream, stderr, _signal): ToolV2Result<string> => {
      stderr.push(...stderrLines);
      return { stdout: fromArray(succeed ? ['ok'] : []), success: () => succeed };
    },
  };
}
