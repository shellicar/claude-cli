import { resolve } from 'node:path';

/** Tools that are always safe to auto-approve */
const READ_ONLY_TOOLS = new Set(['Read', 'Glob', 'Grep', 'WebSearch', 'LS']);

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

export function isReadOnlyTool(toolName: string): boolean {
  return READ_ONLY_TOOLS.has(toolName);
}

/** Check if a file path is inside the given directory */
export function isInsideCwd(filePath: string, cwd: string): boolean {
  const resolved = resolve(cwd, filePath);
  return resolved.startsWith(cwd + '/') || resolved === cwd;
}
