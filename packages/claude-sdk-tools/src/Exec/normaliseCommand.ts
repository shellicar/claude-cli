import { expandPath } from '../expandPath';
import type { NormaliseOptions } from '../types';
import type { Command } from './types';

export function normaliseCommand(cmd: Command, options?: NormaliseOptions): Command {
  const { program, cwd, redirect, ...rest } = cmd;
  return {
    ...rest,
    program: expandPath(program, options),
    cwd: expandPath(cwd, options),
    redirect: redirect && { ...redirect, path: expandPath(redirect.path, options) },
  };
}
