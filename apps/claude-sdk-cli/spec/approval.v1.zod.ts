// Normative schemas for the `approval` concern — copied verbatim from the blueprint's approval-spec.md
// "Message schemas — normative" block. Colocation, not coupling (conformance.md). The conformance JSON
// Schemas are generated from these via `z.toJSONSchema` (spec/generate-schemas.ts).
import { z } from 'zod';

const ts = z.iso.datetime({ offset: true });

/** Enum tolerance, as in the conversation spec: listed values are the ones
 *  defined today; an unknown value still validates. */
const openEnum = <T extends readonly [string, ...string[]]>(values: T) => z.enum(values).or(z.string());

/** Sender identity — same shape and same rule as the conversation spec:
 *  `userId` only when actually known, never fabricated. */
const sender = z.looseObject({
  kind: openEnum(['human', 'agent', 'orchestrator']),
  userId: z.string().optional(),
});

/** Ask types are an open set under add-only. `tool_use` is defined today; a
 *  reviewer that does not know a type still shows the raise and its
 *  correlation. */
const toolUseAsk = z.looseObject({ type: z.literal('tool_use'), name: z.string(), input: z.record(z.string(), z.unknown()) });
const unknownAsk = z.looseObject({ type: z.string() });
const ask = z.union([toolUseAsk, unknownAsk]);

/** Correlation fields appear when they apply; an ask outside any tool call
 *  carries what it has. */
const correlation = z.looseObject({
  conversationId: z.string().optional(),
  queryId: z.string().optional(),
  turnId: z.string().optional(),
  toolUseId: z.string().optional(),
});

// approval.v1.{approvalId}.lifecycle
export const approvalLifecycle = z.discriminatedUnion('type', [z.looseObject({ type: z.literal('raised'), ts, ask, correlation: correlation.optional() }), z.looseObject({ type: z.literal('settled'), ts, approved: z.boolean(), by: sender })]);

// approval.v1.{approvalId}.telemetry
export const approvalTelemetry = z.looseObject({ type: z.literal('heartbeat'), ts });

// approval.v1.{approvalId}.requests
export const approvalRequest = z.looseObject({ type: z.literal('answer'), ts, from: sender, approved: z.boolean() });

// Reply — transport truth, never verdict. Known reasons today:
// already_settled, not_found.
export const answerReply = z.union([z.looseObject({ accepted: z.literal(true) }), z.looseObject({ rejected: z.literal(true), reason: z.string() })]);
