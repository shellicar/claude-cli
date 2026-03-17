import { resolve } from 'node:path';

/** Tools that are always safe to auto-approve (via SDK allowedTools) */
export const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep', 'LS', 'Skill'];

/** Check if a file path is inside the given directory */
export function isInsideCwd(filePath: string, cwd: string): boolean {
  const resolved = resolve(cwd, filePath);
  return resolved.startsWith(`${cwd}/`) || resolved === cwd;
}
