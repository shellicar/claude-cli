import { expandPath } from '@shellicar/claude-core/fs/expandPath';
import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import type { Command } from './types';

/** Expand ~ and $VAR in program, cwd, and redirect file paths (not in "&1"). */
export function normaliseCommands(commands: Command[], fs: IFileSystem): Command[] {
  return commands.map((cmd) => {
    const { program, cwd, redirect, ...rest } = cmd;
    return {
      ...rest,
      program: expandPath(program, fs),
      cwd: expandPath(cwd, fs),
      redirect: redirect && {
        stdout: redirect.stdout != null ? expandPath(redirect.stdout, fs) : undefined,
        stderr: redirect.stderr != null && redirect.stderr !== '&1' ? expandPath(redirect.stderr, fs) : redirect.stderr,
      },
    };
  });
}
