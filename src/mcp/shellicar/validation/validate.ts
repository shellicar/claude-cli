import type { Step, ValidationRule } from '../exec/types';

/** Validate all steps against a set of rules. */
export function validate(steps: Step[], rules: ValidationRule[]): { allowed: boolean; errors: string[] } {
  const errors: string[] = [];
  for (const step of steps) {
    for (const rule of rules) {
      const error = rule.check(step);
      if (error) {
        errors.push(`[${rule.name}] ${error}`);
      }
    }
  }
  return { allowed: errors.length === 0, errors };
}
