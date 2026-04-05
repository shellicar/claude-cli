import type { Command, ExecRule } from './types';

/** Validate commands against a set of rules. */
export function validate(commands: Command[], rules: ExecRule[]): { allowed: boolean; errors: string[] } {
  const errors: string[] = [];
  for (const rule of rules) {
    const error = rule.check(commands);
    if (error) {
      errors.push(`[${rule.name}] ${error}`);
    }
  }
  return { allowed: errors.length === 0, errors };
}
