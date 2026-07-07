import { expandPath } from '@shellicar/claude-core/fs/expandPath';
import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import type { Command } from './types';

// `program` is a program specifier (usually a bare $PATH command), not a path identity, so it is
// unmarked and expanded here. `cwd`, `redirect.stdout`, and `redirect.stderr` are marked paths
// already replaced in place upstream (the literal "&1" is a marked value too, but expandPath is a
// no-op on it).
export function normaliseCommands(commands: Command[], fs: IFileSystem): Command[] {
  return commands.map((cmd) => {
    const { program, ...rest } = cmd;
    return {
      ...rest,
      program: expandPath(program, fs),
    };
  });
}
