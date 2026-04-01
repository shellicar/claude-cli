import { basename } from 'node:path';
import { expandPath } from '@shellicar/mcp-exec';
import { globMatch } from './globMatch';
import type { ApproveRule } from './types';

/**
 * Match a resolved program path against a single approve rule.
 *
 * No slash in rule.program: basename match. With slash: glob path match
 * (supports ~/$HOME expansion and * / ** globs).
 */
export function ruleMatchesProgram(resolvedPath: string, rule: ApproveRule, home: string): boolean {
  const pattern = expandPath(rule.program, { home });
  if (pattern.includes('/')) {
    return globMatch(resolvedPath, pattern);
  }
  const programName = basename(resolvedPath);
  return programName === pattern;
}
