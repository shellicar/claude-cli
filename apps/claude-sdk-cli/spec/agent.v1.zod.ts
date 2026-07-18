// Normative schemas for the `agent` concern — copied verbatim from the blueprint's agent-spec.md
// "Message schemas — normative" block. Colocation, not coupling (conformance.md). The conformance JSON
// Schemas are generated from these via `z.toJSONSchema` (spec/generate-schemas.ts).
import { z } from 'zod';

/** ISO-8601 timestamp with a real UTC offset. */
const ts = z.iso.datetime({ offset: true });

const openEnum = <T extends readonly [string, ...string[]]>(values: T) => z.enum(values).or(z.string());

/** Sender identity, as the conversation spec defines it: provenance,
 *  never enforcement; fields appear only when actually known. */
const sender = z.looseObject({
  kind: openEnum(['human', 'agent', 'orchestrator']),
  userId: z.string().optional(),
});

// Leafed classes are keyed by subject leaf: the subject selects the schema, the
// body carries no `type`. `host` is provenance about the world (a field, never
// the id); ephemeral reach-handles (pid, port, tmux coords) are not named —
// they ride as open fields under looseObject (nats-spec, Naming).

// agent.v1.{world}.telemetry.>
export const agentTelemetry = {
  ready: z.looseObject({ ts, instanceId: z.string(), host: z.string().optional() }),
  pulse: z.looseObject({ ts, instanceId: z.string(), intervalS: z.number().int().positive() }),
  attached: z.looseObject({ ts, instanceId: z.string(), conversationId: z.string(), cwd: z.string().optional() }),
  detached: z.looseObject({ ts, instanceId: z.string(), conversationId: z.string() }),
} as const;

// agent.v1.{world}.requests.> — a leaf not listed is still answered:
// `rejected` with reason `unsupported`.
export const agentRequest = {
  service: z.looseObject({ ts, from: sender.optional(), conversationId: z.string(), cwd: z.string().optional(), model: z.string().optional() }),
  drain: z.looseObject({ ts, from: sender.optional() }),
  chdir: z.looseObject({ ts, from: sender.optional(), conversationId: z.string(), cwd: z.string() }),
} as const;

// Replies (transport truth, never outcome). Known reasons today:
// already_attached, at_capacity, not_found, unsupported.
export const agentRequestReply = z.union([z.looseObject({ accepted: z.literal(true) }), z.looseObject({ rejected: z.literal(true), reason: z.string() })]);
