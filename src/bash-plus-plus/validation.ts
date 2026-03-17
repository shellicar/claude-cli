import type { Command, Step } from './schema.js';

export interface ValidationRule {
  /** Rule name for error messages */
  name: string;
  /** Return error message if blocked, undefined if allowed */
  check: (step: Step) => string | undefined;
}

/** Extract all commands from a step (flattens pipelines). */
function extractCommands(step: Step): Command[] {
  if (step.type === 'command') {
    const { type: _, ...cmd } = step;
    return [cmd];
  }
  return step.commands;
}

/** Validate all steps against a set of rules. */
export function validate(
  steps: Step[],
  rules: ValidationRule[],
): { allowed: boolean; errors: string[] } {
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

// === Built-in rules ===

export const builtinRules: ValidationRule[] = [
  {
    name: 'no-destructive-commands',
    check: (step) => {
      const blocked = new Set(['rm', 'rmdir', 'mkfs', 'dd', 'shred']);
      for (const cmd of extractCommands(step)) {
        if (blocked.has(cmd.program)) {
          return `Command '${cmd.program}' is not permitted. Use a safer alternative.`;
        }
      }
      return undefined;
    },
  },
  {
    name: 'no-force-push',
    check: (step) => {
      for (const cmd of extractCommands(step)) {
        if (cmd.program === 'git' && cmd.args.includes('push') && (cmd.args.includes('--force') || cmd.args.includes('-f'))) {
          return 'Force push is not permitted. Use --force-with-lease instead.';
        }
      }
      return undefined;
    },
  },
  {
    name: 'no-sudo',
    check: (step) => {
      for (const cmd of extractCommands(step)) {
        if (cmd.program === 'sudo') {
          return 'sudo is not permitted. Run commands directly.';
        }
      }
      return undefined;
    },
  },
  {
    name: 'no-env-dump',
    check: (step) => {
      const blocked = new Set(['env', 'printenv']);
      for (const cmd of extractCommands(step)) {
        if (blocked.has(cmd.program) && cmd.args.length === 0) {
          return `'${cmd.program}' without arguments would dump all environment variables. Specify which variable to read.`;
        }
      }
      return undefined;
    },
  },
];
