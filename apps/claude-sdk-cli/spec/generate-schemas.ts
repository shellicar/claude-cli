// Generates the conformance JSON Schemas from the normative zod (conv.v1.zod.ts, conv.v2.zod.ts,
// approval.v1.zod.ts, agent.v1.zod.ts) via `z.toJSONSchema`, so prose and artifact cannot drift
// (conformance.md). One schema per subject (v1) or per subject leaf (v2, agent).
// Run from apps/claude-sdk-cli:  pnpm exec tsx spec/generate-schemas.ts
// Output lands under test/spec/schemas/, not here — the generated artifacts are read only by
// producer.conformance.spec.ts, and every real fs read in the test suite stays contained under
// test/ so it can be told apart from a real spawn/real-disk unit-test violation by directory alone.
//
// `additionalProperties` stays permissive (the zod is `looseObject` throughout — add-only), and the
// harness skips unknown `type`s rather than failing them; neither is encoded as a closed world here.
import { mkdirSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { agentRequest, agentRequestReply, agentTelemetry } from './agent.v1.zod.js';
import { answerReply, approvalLifecycle, approvalRequest, approvalTelemetry } from './approval.v1.zod.js';
import { conversationChange, conversationDelta, conversationRequest, conversationTelemetry, requestReply } from './conv.v1.zod.js';
import { conversationChange as conversationChangeV2, conversationDelta as conversationDeltaV2, conversationRequest as conversationRequestV2, conversationTelemetry as conversationTelemetryV2, requestReply as requestReplyV2 } from './conv.v2.zod.js';

const schemas = {
  'conv.telemetry': conversationTelemetry,
  'conv.changes': conversationChange,
  'conv.deltas': conversationDelta,
  'conv.requests': conversationRequest,
  'conv.reply': requestReply,
  'approval.lifecycle': approvalLifecycle,
  'approval.telemetry': approvalTelemetry,
  'approval.requests': approvalRequest,
  'approval.reply': answerReply,
  // v2 — leafed telemetry/changes/requests, keyed by `{class}.{leaf}` with dots turned to hyphens so
  // the leaf's own dots (turn.started) don't collide with the `{class}.{leaf}` join.
  'conv.v2.deltas': conversationDeltaV2,
  'conv.v2.reply': requestReplyV2,
  'agent.reply': agentRequestReply,
} as const;

const leafedSchemas = {
  'conv.v2.telemetry': conversationTelemetryV2,
  'conv.v2.changes': conversationChangeV2,
  'conv.v2.requests': conversationRequestV2,
  'agent.telemetry': agentTelemetry,
  'agent.requests': agentRequest,
} as const;

const outDir = new URL('../test/spec/schemas/', import.meta.url);
mkdirSync(outDir, { recursive: true });
for (const [name, schema] of Object.entries(schemas)) {
  const json = z.toJSONSchema(schema);
  writeFileSync(new URL(`${name}.schema.json`, outDir), `${JSON.stringify(json, null, 2)}\n`);
}
for (const [prefix, leaves] of Object.entries(leafedSchemas)) {
  for (const [leaf, schema] of Object.entries(leaves)) {
    const json = z.toJSONSchema(schema);
    writeFileSync(new URL(`${prefix}.${leaf}.schema.json`, outDir), `${JSON.stringify(json, null, 2)}\n`);
  }
}
