import { z } from 'zod';

const ToolMatchSchema = z.union([z.string(), z.array(z.string())]);

const ValuePatternSchema = z.union([
  z.array(z.string()),
  z.object({
    allOf: z.array(z.string()).optional(),
    anyOf: z.array(z.string()).optional(),
    suffix: z.string().optional(),
    basename: z.array(z.string()).optional(),
    maxLength: z.number().optional(),
  }),
]);

const VerdictSchema = z.enum(['allow', 'ask', 'deny']);

/** Case 1's schema \u2014 shape only. Deliberately says nothing about whether `tool`/`input` refer
 *  to anything real; that needs a live tool registry (cases 2 and 3), which a shape check alone
 *  can never have. */
export const RuleSchema = z.object({
  tool: ToolMatchSchema.optional(),
  input: z.record(z.string(), ValuePatternSchema).optional(),
  path: z.string().optional(),
  default: VerdictSchema.optional(),
  operations: z.record(z.string(), VerdictSchema).optional(),
  message: z.string().optional(),
});

export const PolicySetSchema = z.array(RuleSchema);

/** What case 2/3 checking needs from a tool registry \u2014 structural, not the concrete
 *  `ToolsV2Registry` class, so this module never depends on Orchestrate's registry directly. */
export type ToolLookup = { get: (name: string) => { model: z.ZodType } | undefined };

export type ValidationResult = { valid: true; warnings: string[] } | { valid: false; errors: string[] };

function hasField(model: z.ZodType, key: string): boolean {
  return model instanceof z.ZodObject && key in model.shape;
}

/** Validates a policy against the three cases decided for it:
 *  1. Wrong shape \u2014 a rule that doesn't parse at all. Invalid, whole policy, every issue
 *     collected (not just the first), since one bad rule can hide a second.
 *  2. A rule scoped to a specific, currently-loaded tool (or list of tools) whose `input`
 *     names a field none of them actually have. There's no legitimate reason to write this
 *     against a tool you can check right now, so it's treated exactly like case 1: invalid,
 *     whole policy. Valid as soon as AT LEAST ONE named tool has the field \u2014 only provably
 *     dead when NONE of the checkable tools do. A wildcard scope (`tool: '*'` or absent) is
 *     never an instance of this case: it has no single schema to be wrong against.
 *  3. A rule scoped to a tool that isn't currently loaded at all. Can't be checked against a
 *     real schema, and might be legitimate forward-looking config (a disabled tool, one from
 *     an unmerged branch) \u2014 so it's a warning, not a rejection; the rest of the policy still
 *     loads. */
export function validatePolicy(policy: unknown, registry: ToolLookup): ValidationResult {
  const parsed = PolicySetSchema.safeParse(policy);
  if (!parsed.success) {
    return { valid: false, errors: parsed.error.issues.map((issue) => `rule${issue.path.length > 0 ? `[${issue.path.join('.')}]` : ''}: ${issue.message}`) };
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  parsed.data.forEach((rule, index) => {
    if (rule.tool == null) {
      return;
    }
    const toolNames = Array.isArray(rule.tool) ? rule.tool : [rule.tool];
    if (toolNames.includes('*')) {
      return;
    }

    for (const name of toolNames) {
      if (registry.get(name) == null) {
        warnings.push(`rule[${index}]: tool "${name}" is not currently registered \u2014 this rule is inert until it is`);
      }
    }

    if (rule.input == null) {
      return;
    }
    const registeredModels = toolNames.map((name) => registry.get(name)).filter((def): def is { model: z.ZodType } => def != null);
    if (registeredModels.length === 0) {
      return; // nothing checkable yet; already warned above
    }
    for (const key of Object.keys(rule.input)) {
      const anyHasField = registeredModels.some((def) => hasField(def.model, key));
      if (!anyHasField) {
        errors.push(`rule[${index}]: input.${key} does not exist on any of [${toolNames.join(', ')}]`);
      }
    }
  });

  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true, warnings };
}
