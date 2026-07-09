// Generates the conformance JSON Schemas from the normative zod (conv.v1.zod.ts, approval.v1.zod.ts)
// via `z.toJSONSchema`, so prose and artifact cannot drift (conformance.md). One schema per subject.
// Run from apps/claude-sdk-cli:  pnpm exec tsx spec/generate-schemas.ts
//
// `additionalProperties` stays permissive (the zod is `looseObject` throughout — add-only), and the
// harness skips unknown `type`s rather than failing them; neither is encoded as a closed world here.
import { mkdirSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { answerReply, approvalLifecycle, approvalRequest, approvalTelemetry } from './approval.v1.zod.js';
import { conversationChange, conversationDelta, conversationRequest, conversationTelemetry, requestReply } from './conv.v1.zod.js';

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
} as const;

const outDir = new URL('./schemas/', import.meta.url);
mkdirSync(outDir, { recursive: true });
for (const [name, schema] of Object.entries(schemas)) {
  const json = z.toJSONSchema(schema);
  writeFileSync(new URL(`${name}.schema.json`, outDir), `${JSON.stringify(json, null, 2)}\n`);
}
