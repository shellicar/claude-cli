import { normaliseCommand } from './normaliseCommand';
import type { ExecInput, NormaliseOptions } from './types';

/** Expand ~ and $VAR in path-like fields (program, cwd, redirect.path) before validation and execution. */
export function normaliseInput(input: ExecInput, options?: NormaliseOptions): ExecInput {
  return {
    ...input,
    steps: input.steps.map((step) => ({
      ...step,
      commands: step.commands.map((cmd) => normaliseCommand(cmd, options)),
    })),
  };
}
