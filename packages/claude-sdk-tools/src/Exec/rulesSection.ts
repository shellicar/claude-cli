import { z } from 'zod';
import type { BlockedCommand } from '../ExecV3/ExecV3';
import type { RuleOverrideMap } from './ruleConfig';

/** Mirrors the shape of `ruleConfigSchema` in apps/claude-sdk-cli/src/cli-config/schema.ts:
 *  `.strict()` so a typo'd key (`program` instead of `programs`) fails instead of being
 *  silently dropped, and a refine so a rule naming no matcher field at all \u2014 which would
 *  otherwise match every command \u2014 is rejected rather than silently accepted. Duplicated
 *  rather than imported because packages/claude-sdk-tools does not depend on the app; if this
 *  ever drifts from the app's copy, keep them in lockstep by hand. */
const ruleConfigSchema = z
  .object({
    programs: z.array(z.string()).optional(),
    programSuffix: z.string().optional(),
    argsAllOf: z.array(z.string()).optional(),
    argsAnyOf: z.array(z.string()).optional(),
    maxArgs: z.number().int().nonnegative().optional(),
    message: z.string().optional(),
  })
  .strict()
  .refine((rule) => rule.programs !== undefined || rule.programSuffix !== undefined || rule.argsAllOf !== undefined || rule.argsAnyOf !== undefined || rule.maxArgs !== undefined, {
    message: 'a rule must set at least one of programs/programSuffix/argsAllOf/argsAnyOf/maxArgs \u2014 one with none would match every command',
  });

const blockedCommandSchema = z.object({
  program: z.string(),
  args: z.array(z.string()).optional().default([]),
});

const rulesSectionSchema = z.object({
  rules: z.record(z.string(), ruleConfigSchema.nullable()).optional().default({}),
  blockedCommands: z.array(blockedCommandSchema).optional().default([]),
});

/** The validated shape of `{ tools.rules, tools.blockedCommands }` \u2014 the two fields isolated
 *  into their own section so a bad entry in one can be pinned to its last known-good value
 *  without taking any other config field down with it. */
export type RulesSectionState = { rules: RuleOverrideMap; blockedCommands: BlockedCommand[] };

export type RulesSectionResult = { ok: true; changed: boolean; state: RulesSectionState } | { ok: false; error: string; state: RulesSectionState };

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Validates `raw` as `{ rules, blockedCommands }`. On success, returns the resolved section
 *  and whether it differs from `previous`. On failure \u2014 a rule with no matcher fields, an
 *  unknown/typo'd key, or any other shape violation \u2014 the whole section fails atomically
 *  (no partially-applying the good rules alongside the bad one) and `previous` is returned
 *  completely unmodified. The caller decides what "failure" means: `RulesConfigGate` throws
 *  on construction and degrades gracefully on `update()`. */
export function resolveRulesSection(raw: unknown, previous: RulesSectionState): RulesSectionResult {
  const parsed = rulesSectionSchema.safeParse(raw);
  if (!parsed.success) {
    const error = parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
    return { ok: false, error, state: previous };
  }
  const state = parsed.data as RulesSectionState;
  return { ok: true, changed: !deepEqual(state, previous), state };
}
