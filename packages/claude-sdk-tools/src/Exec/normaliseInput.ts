import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { normaliseCommand } from './normaliseCommand';
import type { Command, ExecInput } from './types';

/** Expand ~ and $VAR in the tool-owned path fields (program, redirect.path) before validation and
 *  execution. cwd is a marked path, normalised upstream by the SDK. */
export function normaliseInput(input: ExecInput, fs: IFileSystem): ExecInput {
  return {
    ...input,
    steps: input.steps.map((step) => ({
      ...step,
      commands: step.commands.map((cmd) => normaliseCommand(cmd, fs)) as [Command, ...Command[]],
    })),
  };
}
