import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseGitRemote } from '@shellicar/claude-core/memory/environment';
import type { MemoryEnvironment } from '@shellicar/claude-core/memory/types';

const execFileAsync = promisify(execFile);

/** Reads the git remote of the current working directory and labels it (host/org/repo), or {} outside a git repo. */
export async function readGitEnvironment(): Promise<MemoryEnvironment> {
  try {
    const { stdout } = await execFileAsync('git', ['config', '--get', 'remote.origin.url']);
    return parseGitRemote(stdout);
  } catch {
    return {};
  }
}
