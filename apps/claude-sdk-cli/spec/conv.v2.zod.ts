// Normative schemas for the `conv` concern's v2 tree — copied verbatim from the blueprint's
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

// Leafed classes are keyed by subject leaf (the tokens after the class): the
// subject selects the schema, and the body carries no `type`.

// conv.v2.{conversationId}.telemetry.>
export const conversationTelemetry = {
  'turn.started': z.looseObject({ ts, ...turnRef, service: z.string(), model: z.string(), thinking: z.boolean(), effort: z.string().optional(), maxTokens: z.number().int() }),
  'turn.ended': z.looseObject({ ts, ...turnRef, stopReason: z.string() }),
  'turn.cancelled': z.looseObject({ ts, ...turnRef }),
  'turn.aborted': z.looseObject({ ts, ...turnRef }),
  'tool.use': z.looseObject({ ts, ...turnRef, id: z.string(), name: z.string(), input: z.record(z.string(), z.unknown()) }),
  usage: z.looseObject({
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
} as const;

// conv.v2.{conversationId}.changes.> — instanceId is envelope metadata
// (beside from, never inside it): which agent instance published the change.
export const conversationChange = {
  message: z.looseObject({ ts, instanceId: z.string().optional(), id: z.string(), ...turnRef, role: openEnum(['user', 'assistant']), from: sender.optional(), content: contentBlocks }),
  revision: z.looseObject({ ts, instanceId: z.string().optional(), messageId: z.string(), content: contentBlocks }),
  'tip.moved': z.looseObject({ ts, instanceId: z.string().optional(), to: z.string() }),
  query: z.looseObject({ ts, instanceId: z.string().optional(), queryId: z.string(), reason: openEnum(['completed', 'cancelled', 'aborted']) }),
} as const;

// conv.v2.{conversationId}.attachment.> — the wire shape of the model
// agent-spec.md conducts (singular, unconditionally superseding). world is
// provenance, never address, exactly like instanceId — but together they
// are the instance identity (agent-spec.md, The entity), so world is
// required of every compliant publisher; optional here only for producers
// that predate this rule.
export const conversationAttachment = {
  attached: z.looseObject({ ts, instanceId: z.string(), world: z.string().optional(), cwd: z.string().optional(), tip: z.string().nullable().optional(), intervalS: z.number().int().positive().optional() }),
  moved: z.looseObject({ ts, instanceId: z.string(), world: z.string().optional(), cwd: z.string() }),
  detached: z.looseObject({ ts, instanceId: z.string(), world: z.string().optional() }),
} as const;

// conv.v2.{conversationId}.deltas — the one flat subject: `delta` and `block`
// share it, so the type lives in the body here, the single place the subject
// does not spell it. `ts` is waived — deltas are ephemeral and the metadata
// would outweigh the data.
export const conversationDelta = z.discriminatedUnion('type', [z.looseObject({ type: z.literal('delta'), text: z.string() }), z.looseObject({ type: z.literal('block'), blockType: openEnum(['thinking', 'text', 'tool_use']) })]);

// conv.v2.{conversationId}.requests.> — a leaf not listed is still answered:
// `rejected` with reason `unsupported`. Compliance is answering, not implementing.
export const conversationRequest = {
  say: z.looseObject({
    ts,
    from: sender,
    text: z.string(),
    // Reference blocks only — bytes never ride a subject. source.type is an
    // open set; unresolvable sources render as stated placeholders.
    attachments: z
      .array(
        z.looseObject({
          type: z.string(),
          source: z.looseObject({ type: z.string(), id: z.string(), mediaType: z.string().optional(), size: z.number().int().optional() }),
        }),
      )
      .optional(),
    precondition: z.looseObject({ tip: z.string().nullable() }),
  }),
  cancel: z.looseObject({ ts, from: sender.optional(), id: z.string() }),
} as const;

// Replies (transport truth, never outcome). Known reasons today:
// stale, not_found, already_complete, unsupported.
export const requestReply = z.union([z.looseObject({ accepted: z.literal(true), id: z.string().optional() }), z.looseObject({ rejected: z.literal(true), reason: z.string() })]);
