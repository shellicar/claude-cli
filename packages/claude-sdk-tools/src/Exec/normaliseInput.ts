import type { NormaliseOptions } from '../types';
import { normaliseCommand } from './normaliseCommand';
import type { Command, ExecInput } from './types';

/** Expand ~ and $VAR in path-like fields (program, cwd, redirect.path) before validation and execution. */
export function normaliseInput(input: ExecInput, options?: NormaliseOptions): ExecInput {
  return {
    ...input,
    steps: input.steps.map((step) => ({
      ...step,
      commands: step.commands.map((cmd) => normaliseCommand(cmd, options)) as [Command, ...Command[]],
    })),
  };
}
