import { homedir } from 'node:os';
import { basename, resolve } from 'node:path';
import { type ExecInput, expandPath } from '@shellicar/mcp-exec';

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

  const expandedPatterns = patterns.map((p) => expandPath(p));

  for (const step of input.steps) {
    for (const cmd of step.commands) {
      const resolved = resolve(cmd.cwd ?? defaultCwd, expandPath(cmd.program));
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
function ruleMatchesProgram(resolvedPath: string, rule: ApproveRule, home: string): boolean {
  const pattern = expandPath(rule.program, { home });
  if (pattern.includes('/')) {
    return globMatch(resolvedPath, pattern);
  }
  const programName = basename(resolvedPath);
  return programName === pattern;
}

function ruleMatchesArgs(commandArgs: string[], rule: ApproveRule): boolean {
  return !rule.args || rule.args.every((arg) => commandArgs.includes(arg));
}

export function matchRules(program: string, commandArgs: string[], rules: ApproveRule[], cwd: string, home: string): ApproveRule[] {
  const resolvedPath = resolve(cwd, expandPath(program, { home }));
  return rules.filter((rule) => ruleMatchesProgram(resolvedPath, rule, home) && ruleMatchesArgs(commandArgs, rule));
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

  return input.steps.flatMap((s) => s.commands).every((cmd) => matchRules(cmd.program, cmd.args ?? [], rules, cmd.cwd ?? defaultCwd, h).length > 0);
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
