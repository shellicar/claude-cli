import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { minimatch } from 'minimatch';

/** Expand $HOME and ~ in a pattern to the actual home directory. */
function expandHome(pattern: string): string {
  const home = homedir();
  return pattern.replace(/^\$HOME\b/g, home).replace(/^~/g, home);
}

/**
 * Check if all programs in an Exec tool input match at least one auto-approve pattern.
 *
 * Programs are resolved to absolute paths using path.resolve(cwd, program).
 * Patterns support $HOME and ~ expansion, plus standard glob syntax.
 *
 * Returns true only if EVERY program in every step matches at least one pattern.
 */
export function isExecAutoApproved(
  input: { steps?: Array<{ type: string; program?: string; cwd?: string; commands?: Array<{ program: string; cwd?: string }> }> },
  patterns: string[],
  defaultCwd: string,
): boolean {
  if (!patterns.length || !input.steps?.length) {
    return false;
  }

  const expandedPatterns = patterns.map(expandHome);

  for (const step of input.steps) {
    if (step.type === 'command' && step.program) {
      const resolved = resolve(step.cwd ?? defaultCwd, step.program);
      if (!expandedPatterns.some((p) => minimatch(resolved, p))) {
        return false;
      }
    } else if (step.type === 'pipeline' && step.commands) {
      for (const cmd of step.commands) {
        const resolved = resolve(cmd.cwd ?? defaultCwd, cmd.program);
        if (!expandedPatterns.some((p) => minimatch(resolved, p))) {
          return false;
        }
      }
    }
  }

  return true;
}
