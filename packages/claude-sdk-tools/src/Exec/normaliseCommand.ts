import { expandPath } from '@shellicar/claude-core/fs/expandPath';
import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import type { Command } from './types';

// `program` is a program specifier (usually a bare $PATH command), not a path identity, so it is
// unmarked and expanded here. `cwd` and `redirect.path` are marked paths already replaced upstream.
export function normaliseCommand(cmd: Command, fs: IFileSystem): Command {
  const { program, ...rest } = cmd;
  return {
    ...rest,
    program: expandPath(program, fs),
  };
}
