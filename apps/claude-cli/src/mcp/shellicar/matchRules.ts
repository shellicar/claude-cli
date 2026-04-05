import { resolve } from 'node:path';
import { expandPath } from '@shellicar/mcp-exec';
import { ruleMatchesArgs } from './ruleMatchesArgs';
import { ruleMatchesProgram } from './ruleMatchesProgram';
import type { ApproveRule } from './types';

export function matchRules(program: string, commandArgs: string[], rules: ApproveRule[], cwd: string, home: string): ApproveRule[] {
  const resolvedPath = resolve(cwd, expandPath(program, { home }));
  return rules.filter((rule) => ruleMatchesProgram(resolvedPath, rule, home) && ruleMatchesArgs(commandArgs, rule));
}
