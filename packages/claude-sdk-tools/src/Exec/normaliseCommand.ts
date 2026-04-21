import { expandPath } from '@shellicar/claude-core/fs/expandPath';
import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import type { Command } from './types';

export function normaliseCommand(cmd: Command, fs: IFileSystem): Command {
  const { program, cwd, redirect, ...rest } = cmd;
  return {
    ...rest,
    program: expandPath(program, fs),
    cwd: expandPath(cwd, fs),
    redirect: redirect && { ...redirect, path: expandPath(redirect.path, fs) },
  };
}
