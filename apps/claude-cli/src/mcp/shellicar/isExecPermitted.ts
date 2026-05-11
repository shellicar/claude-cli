import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import type { ExecInput } from '@shellicar/claude-sdk-tools/Exec';
import { collectRules } from './collectRules';
import { matchRules } from './matchRules';
import type { ExecPermissions } from './types';

/**
 * Check if an Exec tool input is permitted by the structured execPermissions config.
 *
 * Resolves programs, collects rules from presets + approve, delegates to matchRules.
 * Returns true only if EVERY command in every step is permitted by at least one rule.
 */
export function isExecPermitted(input: ExecInput, permissions: ExecPermissions, defaultCwd: string, fs: IFileSystem): boolean {
  const rules = collectRules(permissions);
  if (!rules.length || !input.steps?.length) {
    return false;
  }

  return input.steps.flatMap((s) => s.commands).every((cmd) => matchRules(cmd.program, cmd.args ?? [], rules, cmd.cwd ?? defaultCwd, fs).length > 0);
}
