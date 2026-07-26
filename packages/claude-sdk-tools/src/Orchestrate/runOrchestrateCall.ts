import type { ApprovalDecision } from '@shellicar/orchestrate-core';
import { execute } from '@shellicar/orchestrate-core';
import type { ToolsV2Registry } from './registry.js';

export type OrchestrateCallResult = { ok: true; content: string } | { ok: false; error: string };

/** The one function a V2 dispatch path needs to call: raw `tool_use.input` in, plain text out —
 *  the same `{ ok, content } | { ok, error }` shape a V1 handler's `run` closure reduces to,
 *  so whatever wires this into the consumer doesn't need a second result shape to reason about.
 *  Parses the wire schema itself rather than trusting a pre-parsed value, mirroring
 *  `ToolRegistry.resolve`'s own single-parse discipline for V1. Every stage's own `input` is
 *  validated against its tool's own `model` — the registry, not a second copy of the shape. */
export async function runOrchestrateCall(input: unknown, registry: ToolsV2Registry, approve?: ApprovalDecision): Promise<OrchestrateCallResult> {
  const parsed = registry.stageSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.message };
  }

  const stages = parsed.data.stages.map((wire) => registry.toStage(wire));
  const { result, reports } = await execute(stages, { grant: { tiers: new Set() }, approve });

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
