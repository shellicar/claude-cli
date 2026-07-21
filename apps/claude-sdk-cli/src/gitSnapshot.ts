import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type GitSnapshot = {
  repo: string;
  worktree: string;
  branch: string;
  head: string;
  stagedFiles: readonly string[];
  unstagedFiles: readonly string[];
  untrackedFiles: readonly string[];
  stashCount: number;
};

// ---------------------------------------------------------------------------
// Parsers — pure functions over raw git output strings.
// Exported so tests can exercise them directly with fixture strings without
// needing a real git process.
// ---------------------------------------------------------------------------

/** The repo's identity: the common git dir, shared by every worktree of the same repo. */
export function parseRepo(output: string): string {
  return output.trim();
}

/** Which checkout you're standing in: the working-tree root, distinct per worktree. */
export function parseWorktree(output: string): string {
  return output.trim();
}

export function parseBranch(output: string): string {
  return output.trim();
}

export function parseHead(output: string): string {
  return output.trim().slice(0, 7);
}

export function parseStatus(output: string): {
  stagedFiles: string[];
  unstagedFiles: string[];
  untrackedFiles: string[];
} {
  const lines = output.split('\n').filter((l) => l.length > 0);
  const stagedFiles: string[] = [];
  const unstagedFiles: string[] = [];
  const untrackedFiles: string[] = [];
  for (const line of lines) {
    const x = line[0] ?? ' '; // staged column
    const y = line[1] ?? ' '; // unstaged column
    const path = line.slice(3);
    if (x === '?' && y === '?') {
      untrackedFiles.push(path);
    } else {
      if (x !== ' ') {
        stagedFiles.push(path);
      }
      if (y !== ' ') {
        unstagedFiles.push(path);
      }
    }
  }
  return {
    stagedFiles: stagedFiles.sort(),
    unstagedFiles: unstagedFiles.sort(),
    untrackedFiles: untrackedFiles.sort(),
  };
}

export function parseStash(output: string): number {
  return output.split('\n').filter((l) => l.trim().length > 0).length;
}

export type HeadDivergence = { onlyOld: number; onlyNew: number };

export function parseDivergence(output: string): HeadDivergence | null {
  const match = output.trim().match(/^(\d+)\s+(\d+)$/);
  if (!match) {
    return null;
  }
  return { onlyOld: Number(match[1]), onlyNew: Number(match[2]) };
}

// ---------------------------------------------------------------------------
// Production runner — executes the four git commands in parallel.
// ---------------------------------------------------------------------------

async function runGit(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args);
  return stdout;
}

export async function gatherHeadDivergence(from: string, to: string, runner: (args: string[]) => Promise<string> = runGit): Promise<HeadDivergence | null> {
  const output = await runner(['rev-list', '--left-right', '--count', `${from}...${to}`]).catch(() => '');
  return parseDivergence(output);
}

export async function gatherGitSnapshot(runner: (args: string[]) => Promise<string> = runGit): Promise<GitSnapshot> {
  const [repoOut, worktreeOut, branchOut, headOut, statusOut, stashOut] = await Promise.all([
    runner(['rev-parse', '--path-format=absolute', '--git-common-dir']).catch(() => ''),
    runner(['rev-parse', '--show-toplevel']).catch(() => ''),
    runner(['branch', '--show-current']).catch(() => ''),
    runner(['rev-parse', 'HEAD']).catch(() => ''),
    runner(['status', '--porcelain']).catch(() => ''),
    runner(['stash', 'list', '--no-decorate']).catch(() => ''),
  ]);
  return {
    repo: parseRepo(repoOut),
    worktree: parseWorktree(worktreeOut),
    branch: parseBranch(branchOut),
    head: parseHead(headOut),
    ...parseStatus(statusOut),
    stashCount: parseStash(stashOut),
  };
}
