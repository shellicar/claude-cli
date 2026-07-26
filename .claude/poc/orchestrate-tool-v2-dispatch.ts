// Scratch POC, Phase 3 step 1 — proves the wire-list-merge + dispatch-fork + per-stage-approval
// shape end to end, using real orchestrate-core (execute/plan) and two real leaves (Find, Head),
// BEFORE touching packages/claude-sdk's real QueryRunner/ToolRegistry. Bottom-up, per the SC's
// own practice for Phases 1-2: prove the shape with real code first, extract the interface after.
//
// Key finding this POC exists to confirm: execute() ALREADY calls `approve(stageName, batch)`
// once per gated stage (see execute.ts's `buffer-then-gate` branch) — per-stage approval isn't
// new machinery to build in orchestrate-core, it's already there. What's missing is purely on
// the consumer side: something that turns that `approve` callback into a real request/response
// round-trip with the human, the way ApprovalCoordinator.request(requestId, onRequest) does for
// V1 today.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execute } from '../../packages/orchestrate-core/dist/esm/index.js';
import type { Leaf, LeafStage, Stage } from '../../packages/orchestrate-core/dist/esm/index.js';

// --- A tiny V2 leaf registry. In real code this lives in claude-sdk-tools, keyed by name,
// built from the already-proven leaves/ directory (createFindLeaf, createHeadLeaf, ...). ---
type FakeFs = { readdir: (p: string) => Promise<string[]> };
const fakeFs: FakeFs = { readdir: async (p) => ['a.tmp', 'b.tmp', 'c.tmp'].map((f) => join(p, f)) };

const findLeaf: Leaf<{ path: string }, string> = {
  name: 'Find',
  operation: 'fs.list',
  run: (input, _upstream, _stderr) => ({
    stdout: (async function* () {
      for (const f of await fakeFs.readdir(input.path)) yield f;
    })(),
    success: () => true,
  }),
};

const headLeaf: Leaf<{ count?: number }, string> = {
  name: 'Head',
  operation: 'none',
  run: (input, upstream) => ({
    stdout: (async function* () {
      if (upstream == null) return;
      let n = 0;
      for await (const v of upstream) {
        yield String(v);
        if (++n >= (input.count ?? 10)) return;
      }
    })(),
    success: () => true,
  }),
};

const v2Leaves = new Map<string, Leaf<never, unknown>>([
  ['Find', findLeaf as Leaf<never, unknown>],
  ['Head', headLeaf as Leaf<never, unknown>],
]);

// --- The wire-facing input shape a real "Orchestrate" tool call would take: a flat sequence of
// { tool, input, op? } stages, or { xargs: paramName } — same shape as Pipe's steps today,
// generalized with operators. This is what the model actually writes in a tool_use block. ---
type WireStage = { tool: string; input: Record<string, unknown>; op?: '|' | '&&' | '||' } | { xargs: string };

function toStages(wire: WireStage[]): Stage[] {
  return wire.map((w): Stage => {
    if ('xargs' in w) return { kind: 'xargs', parameter: w.xargs };
    const leaf = v2Leaves.get(w.tool);
    if (leaf == null) throw new Error(`Orchestrate: unknown V2 tool "${w.tool}"`);
    return { kind: 'leaf', leaf, input: w.input, op: w.op } satisfies LeafStage;
  });
}

// --- Dispatch fork: the one new decision QueryRunner needs to make. Everything else about a
// tool_use (parsing name/input off the block) is unchanged. ---
type ToolUse = { id: string; name: string; input: unknown };
const v1Names = new Set(['Find', 'Match', 'DeleteFile']); // stand-in for the real V1 registry's names

async function dispatch(toolUse: ToolUse, requestApproval: (stageName: string, batch: unknown[]) => Promise<boolean>) {
  if (toolUse.name === 'Orchestrate') {
    const { stages } = toolUse.input as { stages: WireStage[] };
    const result = await execute(toStages(stages), { grant: { tiers: new Set() }, approve: requestApproval });
    return { via: 'v2' as const, result };
  }
  if (v1Names.has(toolUse.name)) {
    return { via: 'v1' as const, result: `(would call V1 registry.resolve("${toolUse.name}", ...))` };
  }
  return { via: 'unavailable' as const, result: null };
}

async function main() {
  const dir = await mkdtemp(join(tmpdir(), 'orchestrate-v2-dispatch-'));
  await writeFile(join(dir, 'a.tmp'), '');
  await writeFile(join(dir, 'b.tmp'), '');
  await writeFile(join(dir, 'c.tmp'), '');

  console.log('=== V1 name still routes to the V1 path, untouched ===');
  console.log(await dispatch({ id: 't1', name: 'Find', input: { path: dir } }, async () => true));

  console.log('\n=== V2 "Orchestrate" call: Find (fs.list, gated) | Head ===');
  let approvalCalls = 0;
  const result = await dispatch(
    {
      id: 't2',
      name: 'Orchestrate',
      input: {
        stages: [
          { tool: 'Find', input: { path: dir }, op: '|' },
          { tool: 'Head', input: { count: 2 } },
        ],
      } satisfies { stages: WireStage[] },
    },
    async (stageName, batch) => {
      approvalCalls++;
      console.log(`  approve() called for stage "${stageName}" with resolved batch:`, batch);
      return true;
    },
  );
  console.log('result:', result);
  console.log(`PASS: approve() was called exactly once, for the gated "Find" stage only (fs.list), not for "Head" (none)`, approvalCalls === 1);

  await rm(dir, { recursive: true, force: true });
}

main();
