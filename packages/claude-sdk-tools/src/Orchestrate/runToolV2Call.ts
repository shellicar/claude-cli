import type { IScopedProvider } from '@shellicar/core-di';
import type { ApprovalDecision, Stage, VarStore } from '@shellicar/orchestrate-core';
import { execute } from '@shellicar/orchestrate-core';
import { OverlayEnvProvider } from '../exec-shared.js';
import type { ToolsV2Registry } from './registry.js';

export type OrchestrateCallResult = { ok: true; content: string; attachments: unknown[] } | { ok: false; error: string };

/** `seq 1 100000 | head -3` is a success in any shell: the producer is killed by SIGPIPE the moment
 *  its reader walks away, and nobody calls that a failed command. */
function stoppedByPipe(report: { signal: string | null }): boolean {
  return report.signal === 'SIGPIPE';
}

function summarise(reports: Awaited<ReturnType<typeof execute>>['reports'], result: unknown[], attachments: unknown[]): OrchestrateCallResult {
  const reportLines = reports.map((r) => {
    if (r.outcome === 'skipped') {
      return `${r.name}: skipped`;
    }
    if (r.outcome === 'denied') {
      return `${r.name}: denied${r.message ? ` — ${r.message}` : ''}`;
    }
    // A producer whose consumer stopped reading is killed by SIGPIPE. That is how a pipeline ends,
    // not a tool going wrong, so it reads as itself rather than as a failure.
    const status = r.success ? 'ok' : stoppedByPipe(r) ? 'stopped (SIGPIPE)' : 'failed';
    // What each stage produced, so an empty result says which stage found nothing, and a stage in
    // the middle of a pipe is not invisible.
    const emitted = r.emitted != null ? `, ${r.emitted} ${r.emitted === 1 ? 'line' : 'lines'}` : '';
    const stderr = r.stderrShown != null && r.stderrShown.length > 0 ? `\n${r.stderrShown.map((l) => `  stderr: ${l}`).join('\n')}` : '';
    return `${r.name}: ${status}${emitted}${stderr}`;
  });

  const anyFailed = reports.some((r) => r.outcome === 'denied' || (r.outcome === 'ran' && r.success === false && !stoppedByPipe(r)));
  const content = [...reportLines, '', ...result.map(String)].join('\n');
  return anyFailed ? { ok: false, error: content } : { ok: true, content, attachments };
}

/** The one function Tools V2 dispatch needs to call: a raw `tool_use.name`/`.input` pair in,
 *  plain text out — the same `{ ok, content } | { ok, error }` shape a V1 handler's `run`
 *  closure reduces to, so the dispatch fork doesn't need a second result shape to reason
 *  about. Covers both wire-call shapes: `name === 'Orchestrate'` takes `{ stages: [...] }` and
 *  composes several tools; any other registered name is a direct single-tool call, wrapped as
 *  a one-stage sequence — both reduce to the same `execute()` call over a `Stage[]`, so a
 *  direct `Find` call still goes through the identical gating/approval path a composed one
 *  does. Parses the wire schema itself rather than trusting a pre-parsed value, mirroring
 *  `ToolRegistry.resolve`'s own single-parse discipline for V1. */
export async function runToolV2Call(name: string, input: unknown, registry: ToolsV2Registry, approve?: ApprovalDecision, signal?: AbortSignal, scope?: IScopedProvider): Promise<OrchestrateCallResult> {
  let stages: Stage[];
  if (name === 'Orchestrate') {
    const parsed = registry.stageSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.message };
    }
    stages = registry.toStages(parsed.data.stages);
  } else {
    const def = registry.get(name);
    if (def == null) {
      return { ok: false, error: `Orchestrate: "${name}" is not a registered V2 tool` };
    }
    const parsedInput = def.model.safeParse(input);
    if (!parsedInput.success) {
      return { ok: false, error: parsedInput.error.message };
    }
    stages = [registry.toStage({ tool: name, input: parsedInput.data as Record<string, unknown> })];
  }

  // One variable namespace per call, cloned from the ambient provider so a `captureAs` writes into
  // this run alone: the next call starts from the ambient environment again, and nothing a
  // pipeline captured can leak into it or into the process's own environment.
  //
  // A capture is written to both: to `captures`, so `$NAME` resolves in a later stage's input, and
  // to the overlay, so a process this run spawns sees it as a real environment variable.
  //
  // `get` reads captures ALONE, never the environment behind the overlay. `resolveReferences` runs
  // over every string field of every stage, so an environment-backed lookup would substitute any
  // ambient variable into any field — `$HOME` inside a file's content, for instance, which is not
  // a reference to anything this run captured. Environment variables expand where a shell would
  // expand them: on a command line, in `Program`, against the environment that call spawns under.
  const captures = new Map<string, string>();
  const runEnv = new OverlayEnvProvider(registry.envProvider);
  const vars: VarStore = {
    get: (n) => captures.get(n),
    set: (n, v) => {
      captures.set(n, v);
      runEnv.set(n, v);
    },
  };

  const { result, reports, attachments } = await execute(stages, { grant: { tiers: new Set() }, approve, signal, scope, vars, env: runEnv });
  return summarise(reports, result, attachments);
}
