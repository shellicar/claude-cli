import { resolve } from 'node:path';

/** Tools that are always safe to auto-approve (via SDK allowedTools) */
export const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep', 'LS'];

export interface Config {
  /** Auto-approve Edit and Write tools for files inside cwd */
  autoApproveEdits: boolean;
  /** Auto-approve read-only tools without prompting */
  autoApproveReads: boolean;
}

const defaults: Config = {
  autoApproveEdits: true,
  autoApproveReads: true,
};

let current: Config = { ...defaults };

export function getConfig(): Readonly<Config> {
  return current;
}

export function updateConfig(partial: Partial<Config>): void {
  current = { ...current, ...partial };
}

/** Check if a file path is inside the given directory */
export function isInsideCwd(filePath: string, cwd: string): boolean {
  const resolved = resolve(cwd, filePath);
  return resolved.startsWith(cwd + '/') || resolved === cwd;
}
