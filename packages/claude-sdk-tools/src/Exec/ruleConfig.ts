import { z } from 'zod';
import type { ExecRule } from './types';

/** A declarative safety rule's match/message fields. The rule's name is never a field on this
 *  type — it's the key under which the rule lives in a `RuleConfigMap`, since the rules
 *  themselves are config, not a separate set of patches applied over hidden logic. */
export type RuleConfig = {
  /** The command's program (basename, path stripped) must be one of these. */
  programs?: string[];
  /** The command's program (basename) must end with this suffix, e.g. ".exe". */
  programSuffix?: string;
  /** Every one of these normalised flags must be present in the command's args. */
  argsAllOf?: string[];
  /** At least one of these normalised flags must be present in the command's args. */
  argsAnyOf?: string[];
  /** The command's args array must not exceed this length. */
  maxArgs?: number;
  /** Refusal message. `{program}` is replaced with the matched command's actual program string. */
  message?: string;
};

/** The canonical schema for `RuleConfig` — the single source of truth `rulesSection.ts` (internal
 *  validation) and the app's `cli-config/schema.ts` (user-facing config + generated JSON Schema)
 *  both build on, so the two never have to be kept in step by hand. `.strict()` so an unknown/
 *  typo'd key (`program` instead of `programs`) fails instead of being silently dropped, and the
 *  refine rejects a rule naming no matcher field at all — which would otherwise match every
 *  command — rather than silently accepting it. */
export const ruleConfigSchema = z
  .object({
    programs: z.array(z.string()).optional().describe("The command's program (basename, path stripped) must be one of these."),
    programSuffix: z.string().optional().describe('The program (basename) must end with this suffix, e.g. ".exe".'),
    argsAllOf: z.array(z.string()).optional().describe("Every one of these normalised flags must be present in the command's args (order-independent; --foo=bar normalises to --foo, bundled -ni normalises to -n, -i)."),
    argsAnyOf: z.array(z.string()).optional().describe('At least one of these normalised flags must be present.'),
    maxArgs: z.number().int().nonnegative().optional().describe("The command's args array must not exceed this length."),
    message: z.string().optional().describe('Refusal message shown to the model. "{program}" is replaced with the matched command\'s actual program string.'),
  })
  .strict()
  .refine((rule) => rule.programs !== undefined || rule.programSuffix !== undefined || rule.argsAllOf !== undefined || rule.argsAnyOf !== undefined || rule.maxArgs !== undefined, {
    message: 'A rule must set at least one of programs/programSuffix/argsAllOf/argsAnyOf/maxArgs — a rule with none of these would match every command.',
  });

/** Every rule, keyed by name. `defaultRules` is one of these; config resolves to another. */
export type RuleConfigMap = Record<string, RuleConfig>;

/** What a config file provides: per rule name, a replacement definition, or `null` to remove
 *  that rule (built-in or otherwise) entirely. A key absent from this map leaves the
 *  corresponding default (if any) untouched. */
export type RuleOverrideMap = Record<string, RuleConfig | null>;

type MatchableCommand = { program: string; args: string[] };

function basename(program: string): string {
  const idx = Math.max(program.lastIndexOf('/'), program.lastIndexOf('\\'));
  return idx === -1 ? program : program.slice(idx + 1);
}

/** `--foo=bar` -> `--foo` (the value is never matched on). A single-dash multi-character token is
 *  ambiguous on shape alone — `-ni` is bundled short flags (POSIX getopt: `-n -i`), but `-exec` is
 *  one word-flag (find's convention) — so both readings are kept rather than choosing: the token
 *  normalises to itself *plus* its exploded per-character short flags. `argsAnyOf: ['-exec']` still
 *  matches the literal token; `argsAnyOf: ['-i']` still matches `-ni` via the exploded form. */
function normaliseArg(arg: string): string[] {
  if (arg.startsWith('--')) {
    const eq = arg.indexOf('=');
    return [eq === -1 ? arg : arg.slice(0, eq)];
  }
  if (arg.startsWith('-') && arg.length > 2) {
    return [
      arg,
      ...arg
        .slice(1)
        .split('')
        .map((c) => `-${c}`),
    ];
  }
  return [arg];
}

function normaliseArgs(args: string[]): string[] {
  return args.flatMap(normaliseArg);
}

/** A rule with none of these fields set would otherwise match every command — whatever
 *  broke it (a typo, a forgotten field) must not silently turn into "block everything". */
const matcherFields = ['programs', 'programSuffix', 'argsAllOf', 'argsAnyOf', 'maxArgs'] as const;

export function hasMatcher(rule: RuleConfig): boolean {
  return matcherFields.some((field) => rule[field] !== undefined);
}

export function ruleConfigMatches(cmd: MatchableCommand, rule: RuleConfig): boolean {
  if (!hasMatcher(rule)) {
    return false;
  }
  const program = basename(cmd.program);
  if (rule.programs && !rule.programs.includes(program)) {
    return false;
  }
  if (rule.programSuffix && !program.endsWith(rule.programSuffix)) {
    return false;
  }
  if (rule.maxArgs != null && cmd.args.length > rule.maxArgs) {
    return false;
  }
  if (rule.argsAllOf || rule.argsAnyOf) {
    const flags = normaliseArgs(cmd.args);
    if (rule.argsAllOf && !rule.argsAllOf.every((f) => flags.includes(f))) {
      return false;
    }
    if (rule.argsAnyOf && !rule.argsAnyOf.some((f) => flags.includes(f))) {
      return false;
    }
  }
  return true;
}

/** Resolves `defaults` and config-supplied `overrides` into the rule set that actually runs.
 *  A key in `overrides` set to `null` removes that rule (built-in or not); set to a definition,
 *  it replaces that key's rule wholesale — config is the rule, not a patch onto one. A key
 *  `overrides` never mentions leaves the default (if any) exactly as it was. */
export function resolveRules(defaults: RuleConfigMap, overrides: RuleOverrideMap): RuleConfigMap {
  const resolved: RuleConfigMap = { ...defaults };
  for (const [name, rule] of Object.entries(overrides)) {
    if (rule === null) {
      delete resolved[name];
    } else {
      resolved[name] = rule;
    }
  }
  return resolved;
}

/** Builds the runnable `ExecRule[]` a validator consumes from a resolved `RuleConfigMap`. */
export function buildExecRules(rules: RuleConfigMap): ExecRule[] {
  return Object.entries(rules).map(([name, rule]) => ({
    name,
    check: (commands: MatchableCommand[]) => {
      for (const cmd of commands) {
        if (ruleConfigMatches(cmd, rule)) {
          return (rule.message ?? `'{program}' is blocked by rule '${name}'.`).replaceAll('{program}', cmd.program);
        }
      }
      return undefined;
    },
  }));
}

/** The built-in safety rules, as data — a faithful re-expression of what was previously hardcoded
 *  logic, nothing added. `tools.rules` in config resolves over this map by key (see
 *  `resolveRules`): a key naming a built-in replaces it, `null` removes it, any other key adds
 *  a new rule. */
export const defaultRules: RuleConfigMap = {
  'no-destructive-commands': {
    programs: ['rm', 'rmdir', 'mkfs', 'dd', 'shred'],
    message: "'{program}' is destructive and irreversible. Ask the user to run it directly.",
  },
  'no-xargs': {
    programs: ['xargs'],
    message: 'xargs can execute arbitrary commands on piped input. Write commands explicitly, or use Glob/Grep tools.',
  },
  'no-sed-in-place': {
    programs: ['sed'],
    argsAnyOf: ['-i', '--in-place'],
    message: 'sed -i modifies files in-place with no undo. Use the redirect option to write to a new file, or use the Edit tool.',
  },
  'no-git-rm': {
    programs: ['git'],
    argsAllOf: ['rm'],
    message: 'git rm is destructive and irreversible. Ask the user to run it directly.',
  },
  'no-git-checkout': {
    programs: ['git'],
    argsAllOf: ['checkout'],
    message: 'git checkout can discard uncommitted changes with no undo. Use "git switch" for branches, or ask the user to run it directly.',
  },
  'no-git-reset': {
    programs: ['git'],
    argsAllOf: ['reset'],
    message: 'git reset is destructive and irreversible. Ask the user to run it directly.',
  },
  'no-force-push': {
    programs: ['git'],
    argsAllOf: ['push'],
    argsAnyOf: ['-f', '--force', '--force-with-lease', '--force-if-includes'],
    message: 'Force push overwrites remote history with no undo. Use regular "git push", or ask the user to run it directly.',
  },
  'no-exe': {
    programSuffix: '.exe',
    message: "'{program}' — there is no reason to call .exe. Run equivalent commands natively.",
  },
  'no-sudo': {
    programs: ['sudo'],
    message: 'sudo is not permitted. Run commands directly.',
  },
  'no-git-C': {
    programs: ['git'],
    argsAnyOf: ['-C', '--git-dir', '--work-tree', '-c'],
    message: 'git -C/--git-dir/--work-tree changes the working directory, and -c overrides config (including code-execution hooks like core.pager, core.sshCommand, credential.helper) outside review. Use cwd instead, and avoid -c overrides.',
  },
  'no-pnpm-C': {
    programs: ['pnpm'],
    argsAnyOf: ['-C'],
    message: 'pnpm -C changes the working directory and bypasses auto-approve path checks. Use cwd instead.',
  },
  'no-env-dump': {
    programs: ['env', 'printenv'],
    maxArgs: 0,
    message: "'{program}' without arguments would dump all environment variables. Specify which variable to read.",
  },
  'no-git-clean': {
    programs: ['git'],
    argsAllOf: ['clean'],
    message: 'git clean deletes untracked files with no undo. Ask the user to run it directly.',
  },
  'no-inline-interpreter': {
    programs: ['sh', 'bash', 'zsh', 'python', 'python3', 'node', 'ruby', 'perl', 'osascript'],
    argsAnyOf: ['-c', '-e', '--eval'],
    message: "'{program}' with inline code ('-c'/'-e'/'--eval') runs unreviewed content directly, bypassing the reviewable CreateFile/EditFile path. Write it to a file, then run that file.",
  },
  'no-find-exec': {
    programs: ['find'],
    argsAnyOf: ['-exec', '-execdir', '-ok', '-okdir'],
    message: "find's -exec/-execdir/-ok/-okdir runs unreviewed commands directly. Write the command to a file and run it, or use the Find/Match tools.",
  },
};
