import { resolve } from 'node:path';
import { expandPath } from '@shellicar/claude-core/fs/expandPath';
import type { ExecInput } from '@shellicar/claude-sdk-tools/Exec';
import { nodeFs } from '@shellicar/claude-sdk-tools/fs';
import { globMatch } from './globMatch';

/**
 * Check if all programs in an Exec tool input match at least one auto-approve pattern.
 *
 * Programs are resolved to absolute paths using path.resolve(cwd, program).
 * Patterns support $HOME and ~ expansion, plus * and ** glob syntax.
 *
 * Returns true only if EVERY program in every step matches at least one pattern.
 */
export function isExecAutoApproved(input: ExecInput, patterns: string[], defaultCwd: string): boolean {
  if (!patterns.length || !input.steps?.length) {
    return false;
  }

  const expandedPatterns = patterns.map((p) => expandPath(p, nodeFs));

  for (const step of input.steps) {
    for (const cmd of step.commands) {
      const resolved = resolve(cmd.cwd ?? defaultCwd, expandPath(cmd.program, nodeFs));
      if (!expandedPatterns.some((p) => globMatch(resolved, p))) {
        return false;
      }
    }
  }

  return true;
}
