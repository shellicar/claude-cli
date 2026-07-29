import type { IScopedProvider } from '@shellicar/core-di';
import type { ApprovalDecision, Stage, VarStore } from '@shellicar/orchestrate-core';
import { execute } from '@shellicar/orchestrate-core';
import { OverlayEnvProvider } from '../exec-shared.js';
import type { ToolsV2Registry } from './registry.js';

export type OrchestrateCallResult = { ok: true; content: string; attachments: unknown[] } | { ok: false; error: string };

function summarise(reports: Awaited<ReturnType<typeof execute>>['reports'], result: unknown[], attachments: unknown[]): OrchestrateCallResult {
  const reportLines = reports.map((r) => {
    if (r.outcome === 'skipped') {
      return `${r.name}: skipped`;
    }
    if (r.outcome === 'denied') {
      return `${r.name}: denied${r.message ? ` — ${r.message}` : ''}`;
    }
    const status = r.success ? 'ok' : 'failed';
    const stderr = r.stderrShown != null && r.stderrShown.length > 0 ? `\n${r.stderrShown.map((l) => `  stderr: ${l}`).join('\n')}` : '';
    return `${r.name}: ${status}${stderr}`;
  });

  const anyFailed = reports.some((r) => r.outcome === 'denied' || (r.outcome === 'ran' && r.success === false));
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
    stages = parsed.data.stages.map((wire) => registry.toStage(wire));
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
  const runEnv = new OverlayEnvProvider(registry.envProvider);
  const vars: VarStore = { get: (n) => runEnv.get(n), set: (n, v) => runEnv.set(n, v) };

  const { result, reports, attachments } = await execute(stages, { grant: { tiers: new Set() }, approve, signal, scope, vars, env: runEnv });
  return summarise(reports, result, attachments);
}
