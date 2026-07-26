import { expandPath } from '@shellicar/claude-core/fs/expandPath';
import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { PhysicalAgentContext } from '../fs/PhysicalAgentContext.js';
import type { Command } from './types';

// Process-global today: no subagent-scoped cwd/env yet (separately scoped work).
const physicalContext = new PhysicalAgentContext();

// `program` and the `redirect` targets are expanded here (all unmarked): program is a $PATH command,
// and a redirect target is relative to this command's own cwd (resolved against it in runPipeline),
// not the CLI's, so it is expanded by the tool rather than the SDK path marker. `cwd` is a marked path
// already replaced in place upstream. The literal "&1" on stderr survives expandPath unchanged.
export function normaliseCommands(commands: Command[], fs: IFileSystem): Command[] {
  return commands.map((cmd) => {
    const { program, redirect, ...rest } = cmd;
    return {
      ...rest,
      program: expandPath(program, fs, physicalContext),
      ...(redirect ? { redirect: { ...redirect, stdout: expandPath(redirect.stdout, fs, physicalContext), stderr: expandPath(redirect.stderr, fs, physicalContext) } } : {}),
    };
  });
}
