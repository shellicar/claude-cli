// Normative schemas for the `conv` concern — copied verbatim from the blueprint's
// conversation-spec.md "Message schemas — normative" block. Colocation, not coupling: no cross-repo
// dependency until the specs are stable (conformance.md). The conformance JSON Schemas are generated
// from these via `z.toJSONSchema` (spec/generate-schemas.ts), so prose and artifact cannot drift.
import { z } from 'zod';

/** ISO-8601 timestamp with a real UTC offset (e.g. 2026-07-07T21:00:00+10:00). */
const ts = z.iso.datetime({ offset: true });

/** The tolerance rule for enums: the listed values are the ones defined
 *  today; an unknown value still validates (a closed enum here would make
 *  every addition a breaking change — the POC's closed-enum defect). */
const openEnum = <T extends readonly [string, ...string[]]>(values: T) => z.enum(values).or(z.string());

/** Sender identity. `userId` appears only when the publisher actually knows
 *  it — never fabricated. A local CLI knows a human typed, not which human:
 *  it publishes `{ kind: 'human' }` bare. `from` is provenance, never
 *  enforcement (nats-spec). */
const sender = z.looseObject({
  kind: openEnum(['human', 'agent', 'orchestrator']),
  userId: z.string().optional(),
});

/** Content blocks are the agent model's own; opaque typed blocks pending the
 *  content vocabulary's design pass. */
const contentBlocks = z.array(z.looseObject({ type: z.string() }));

const turnRef = { queryId: z.string(), turnId: z.string() };

// conv.v1.{conversationId}.telemetry
export const conversationTelemetry = z.discriminatedUnion('type', [
  z.looseObject({ type: z.literal('turn_started'), ts, ...turnRef, service: z.string(), model: z.string(), thinking: z.boolean(), effort: z.string().optional(), maxTokens: z.number().int() }),
  z.looseObject({ type: z.literal('turn_ended'), ts, ...turnRef, stopReason: z.string() }),
  z.looseObject({ type: z.literal('turn_cancelled'), ts, ...turnRef }),
  z.looseObject({ type: z.literal('turn_aborted'), ts, ...turnRef }),
  z.looseObject({ type: z.literal('tool_use'), ts, ...turnRef, id: z.string(), name: z.string(), input: z.record(z.string(), z.unknown()) }),
  z.looseObject({
    type: z.literal('usage'),
    ts,
    ...turnRef,
    service: z.string(),
    model: z.string(),
    inputTokens: z.number().int(),
    cacheCreationTokens: z.number().int(),
    cacheReadTokens: z.number().int(),
    outputTokens: z.number().int(),
    // Per-frame extras — present when the frame reported them, never synthesised:
    cacheCreation5mTokens: z.number().int().optional(),
    cacheCreation1hTokens: z.number().int().optional(),
    thinkingTokens: z.number().int().optional(),
    serverToolUse: z.record(z.string(), z.unknown()).optional(),
    // Derived by the publisher (the service reports tokens, not prices); present when computed:
    costUsd: z.number().optional(),
  }),
]);

// conv.v1.{conversationId}.changes
export const conversationChange = z.discriminatedUnion('type', [
  z.looseObject({ type: z.literal('message'), ts, id: z.string(), ...turnRef, role: openEnum(['user', 'assistant']), from: sender, content: contentBlocks }),
  z.looseObject({ type: z.literal('revision'), ts, messageId: z.string(), content: contentBlocks }),
  z.looseObject({ type: z.literal('tip_moved'), ts, to: z.string() }),
]);

// conv.v1.{conversationId}.deltas — deliberately bare: the envelope's `ts` is
// waived on purpose; deltas are ephemeral and the metadata would outweigh the data.
export const conversationDelta = z.looseObject({ type: z.literal('delta'), text: z.string() });

// conv.v1.{conversationId}.requests — a request whose `type` is not defined
// here is still answered: `rejected` with reason `unsupported`. Compliance is
// answering, not implementing.
export const conversationRequest = z.discriminatedUnion('type', [
  z.looseObject({ type: z.literal('say'), ts, from: sender, text: z.string(), precondition: z.looseObject({ tip: z.string() }).optional() }),
  z.looseObject({ type: z.literal('cancel'), ts, from: sender.optional(), id: z.string() }),
]);

// Replies (transport truth, never outcome). Known reasons today:
// stale, not_found, already_complete, unsupported.
export const requestReply = z.union([z.looseObject({ accepted: z.literal(true), id: z.string().optional() }), z.looseObject({ rejected: z.literal(true), reason: z.string() })]);
