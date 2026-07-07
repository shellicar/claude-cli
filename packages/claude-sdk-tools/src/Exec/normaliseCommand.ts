import { expandPath } from '@shellicar/claude-core/fs/expandPath';
import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import type { Command } from './types';

// `program` and `redirect.path` are expanded here (both unmarked): program is a $PATH command, and a
// redirect target is relative to this command's own cwd, not the CLI's, so it is expanded by the tool
// rather than the SDK path marker. `cwd` is a marked path already replaced in place upstream.
export function normaliseCommand(cmd: Command, fs: IFileSystem): Command {
  const { program, redirect, ...rest } = cmd;
  return {
    ...rest,
    program: expandPath(program, fs),
    ...(redirect ? { redirect: { ...redirect, path: expandPath(redirect.path, fs) } } : {}),
  };
}
