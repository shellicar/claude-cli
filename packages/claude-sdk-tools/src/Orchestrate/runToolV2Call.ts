import type { ApprovalDecision, Stage } from '@shellicar/orchestrate-core';
import { execute } from '@shellicar/orchestrate-core';
import type { ToolsV2Registry } from './registry.js';

export type OrchestrateCallResult = { ok: true; content: string } | { ok: false; error: string };

function summarise(reports: Awaited<ReturnType<typeof execute>>['reports'], result: unknown[]): OrchestrateCallResult {
  const reportLines = reports.map((r) => {
    if (!r.ran) return `${r.name}: skipped`;
    const status = r.success ? 'ok' : 'failed';
    const stderr = r.stderrShown != null && r.stderrShown.length > 0 ? `\n${r.stderrShown.map((l) => `  stderr: ${l}`).join('\n')}` : '';
    return `${r.name}: ${status}${stderr}`;
  });

  const anyFailed = reports.some((r) => r.ran && r.success === false);
  const content = [...reportLines, '', ...result.map(String)].join('\n');
  return anyFailed ? { ok: false, error: content } : { ok: true, content };
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
export async function runToolV2Call(name: string, input: unknown, registry: ToolsV2Registry, approve?: ApprovalDecision): Promise<OrchestrateCallResult> {
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

  const { result, reports } = await execute(stages, { grant: { tiers: new Set() }, approve });
  return summarise(reports, result);
}
