import { homedir } from 'node:os';
import { basename, resolve } from 'node:path';
import type { ExecInput } from '@shellicar/mcp-exec';

/** Expand $HOME and ~ in a pattern to the actual home directory. */
function expandHome(pattern: string): string {
  return expandHomeWith(pattern, homedir());
}

function expandHomeWith(pattern: string, home: string): string {
  return pattern.replace(/^\$HOME\b/g, home).replace(/^~/g, home);
}

/**
 * Simple glob matcher supporting * (single segment) and ** (any depth).
 * Zero dependencies — handles the subset of globs needed for path matching.
 */
function globMatch(path: string, pattern: string): boolean {
  const pathParts = path.split('/').filter(Boolean);
  const patParts = pattern.split('/').filter(Boolean);

  return match(pathParts, 0, patParts, 0);
}

function match(path: string[], pi: number, pat: string[], gi: number): boolean {
  // Both exhausted — match
  if (pi === path.length && gi === pat.length) {
    return true;
  }
  // Pattern exhausted but path remains — no match
  if (gi === pat.length) {
    return false;
  }

  const segment = pat[gi];

  // ** matches zero or more path segments
  if (segment === '**') {
    // Try matching ** against 0, 1, 2, ... path segments
    for (let skip = 0; skip <= path.length - pi; skip++) {
      if (match(path, pi + skip, pat, gi + 1)) {
        return true;
      }
    }
    return false;
  }

  // Path exhausted but non-** pattern remains — no match
  if (pi === path.length) {
    return false;
  }

  // * matches any single segment, literal must match exactly
  if (segment === '*' || segmentMatch(path[pi], segment)) {
    return match(path, pi + 1, pat, gi + 1);
  }

  return false;
}

/** Match a path segment against a pattern segment with * wildcards (e.g. *.sh, test-*). */
function segmentMatch(value: string, pattern: string): boolean {
  if (pattern === '*') {
    return true;
  }
  if (!pattern.includes('*')) {
    return value === pattern;
  }

  // Convert segment pattern to regex: * → .*, escape the rest
  const regex = new RegExp('^' + pattern.split('*').map(escapeRegex).join('.*') + '$');
  return regex.test(value);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

  const expandedPatterns = patterns.map(expandHome);

  for (const step of input.steps) {
    for (const cmd of step.commands) {
      const resolved = resolve(cmd.cwd ?? defaultCwd, cmd.program);
      if (!expandedPatterns.some((p) => globMatch(resolved, p))) {
        return false;
      }
    }
  }

  return true;
}

export interface ApproveRule {
  program: string;
  args?: string[];
}

export interface ExecPermissions {
  presets?: string[];
  approve?: ApproveRule[];
}

/**
 * Match a resolved program path and command args against a set of approve rules.
 *
 * Returns all rules that match. Program matching: no slash = basename match,
 * with slash = path match (supports ~/$HOME expansion and * / ** globs).
 * Args use AND logic: all specified args must appear in the command args (any position).
 */
export function matchRules(resolvedPath: string, commandArgs: string[], rules: ApproveRule[], _defaultCwd: string, home: string): ApproveRule[] {
  return rules.filter((rule) => {
    const programMatches = rule.program.includes('/') ? globMatch(resolvedPath, expandHomeWith(rule.program, home)) : basename(resolvedPath) === rule.program;

    if (!programMatches) {
      return false;
    }
    if (!rule.args) {
      return true;
    }
    return rule.args.every((arg) => commandArgs.includes(arg));
  });
}

/**
 * Check if an Exec tool input is permitted by the structured execPermissions config.
 *
 * Resolves programs, collects rules from presets + approve, delegates to matchRules.
 * Returns true only if EVERY command in every step is permitted by at least one rule.
 */
export function isExecPermitted(input: ExecInput, permissions: ExecPermissions, defaultCwd: string, home?: string): boolean {
  const h = home ?? homedir();
  const rules = collectRules(permissions);
  if (!rules.length || !input.steps?.length) {
    return false;
  }

  for (const step of input.steps) {
    for (const cmd of step.commands) {
      const resolvedPath = resolve(cmd.cwd ?? defaultCwd, cmd.program);
      const commandArgs = cmd.args ?? [];
      if (matchRules(resolvedPath, commandArgs, rules, defaultCwd, h).length === 0) {
        return false;
      }
    }
  }
  return true;
}

const PRESET_RULES: Record<string, ApproveRule[]> = {
  defaults: [{ program: '~/.claude/skills/*/scripts/*.sh' }],
};

function collectRules(permissions: ExecPermissions): ApproveRule[] {
  const rules: ApproveRule[] = [];
  if (permissions.presets) {
    for (const preset of permissions.presets) {
      const presetRules = PRESET_RULES[preset];
      if (presetRules) {
        rules.push(...presetRules);
      }
    }
  }
  if (permissions.approve) {
    rules.push(...permissions.approve);
  }
  return rules;
}
