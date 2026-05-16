import { resolve } from 'node:path';
import { expandPath } from '@shellicar/claude-core/fs/expandPath';
import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { ruleMatchesArgs } from './ruleMatchesArgs';
import { ruleMatchesProgram } from './ruleMatchesProgram';
import type { ApproveRule } from './types';

export function matchRules(program: string, commandArgs: string[], rules: ApproveRule[], cwd: string, fs: IFileSystem): ApproveRule[] {
  const resolvedPath = resolve(cwd, expandPath(program, fs));
  return rules.filter((rule) => ruleMatchesProgram(resolvedPath, rule, fs) && ruleMatchesArgs(commandArgs, rule));
}
