import { resolve } from 'node:path';

/** Tools that are always safe to auto-approve (via SDK allowedTools) */
export const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep', 'LS'];

/** Bash commands that are safe to auto-approve (prefix match) */
const SAFE_BASH_PREFIXES = [
  'git status',
  'git log',
  'git diff',
  'git show',
  'git branch',
  'git remote',
  'git rev-parse',
  'git rev-list',
  'git merge-base',
  'git fetch',
  'git ls-files',
  'git stash list',
  'ls ',
  'pwd',
  'cat ',
  'head ',
  'tail ',
  'wc ',
  'echo ',
  'which ',
  'node --version',
  'node -v',
  'pnpm --version',
  'pnpm outdated',
  'pnpm why',
  'pnpm ls',
  'pnpm audit',
  'pnpm run type-check',
  'npm --version',
  'npx --version',
];

export interface Config {
  /** Auto-approve Edit and Write tools for files inside cwd */
  autoApproveEdits: boolean;
  /** Auto-approve read-only tools without prompting */
  autoApproveReads: boolean;
  /** Auto-approve safe Bash commands */
  autoApproveSafeBash: boolean;
}

const defaults: Config = {
  autoApproveEdits: true,
  autoApproveReads: true,
  autoApproveSafeBash: true,
};

let current: Config = { ...defaults };

export function getConfig(): Readonly<Config> {
  return current;
}

export function updateConfig(partial: Partial<Config>): void {
  current = { ...current, ...partial };
}

export function isSafeBashCommand(command: string): boolean {
  const trimmed = command.trim();
  return SAFE_BASH_PREFIXES.some((prefix) => trimmed === prefix || trimmed.startsWith(prefix));
}

/** Check if a file path is inside the given directory */
export function isInsideCwd(filePath: string, cwd: string): boolean {
  const resolved = resolve(cwd, filePath);
  return resolved.startsWith(cwd + '/') || resolved === cwd;
}
