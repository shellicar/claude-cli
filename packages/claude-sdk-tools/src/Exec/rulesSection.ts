import { z } from 'zod';
import { type BlockedCommand, blockedCommandSchema } from '../ExecV3/ExecV3';
import { type RuleOverrideMap, ruleConfigSchema } from './ruleConfig';

// rulesSectionSchema builds on the same ruleConfigSchema/blockedCommandSchema the app's
// cli-config/schema.ts composes into sdkConfigSchema — one definition of each, not two hand-kept
// in lockstep.
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
