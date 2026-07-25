import { join } from 'node:path';
import type { FileRecord } from '@shellicar/claude-core/fs/records';
import type { FindOptions, IFileEntry, StatResult } from '@shellicar/claude-core/fs/types';

interface WalkFs {
  readdir(path: string): Promise<IFileEntry[]>;
  realpath(path: string): Promise<string>;
  readlink(path: string): Promise<string>;
  stat(path: string): Promise<StatResult>;
}

/** A lazy sibling of `@shellicar/claude-core`'s `walk` — same traversal rules (exclude,
 *  maxDepth, type, followSymlinks, cycle detection via realpath), but yields each record as
 *  it's discovered instead of collecting the whole tree into an array first. This is what
 *  lets a downstream consumer (e.g. `Head`) short-circuit an unbounded or expensive walk,
 *  which the buffered version structurally cannot do. Deliberately a separate function, not a
 *  change to the shared `walk` V1 tools already depend on — see the design doc's "Tools V2 as
 *  a separate system" decision. */
export async function* walkLazy(fs: WalkFs, dir: string, options: FindOptions, depth: number, re: RegExp | undefined, visited: Set<string> = new Set()): AsyncGenerator<FileRecord, void, unknown> {
  const { maxDepth, exclude = [], type = 'file', followSymlinks = true } = options;

  if (maxDepth !== undefined && depth > maxDepth) {
    return;
  }

  const realDir = await fs.realpath(dir);
  if (visited.has(realDir)) {
    return;
  }
  visited.add(realDir);

  // The top-level call lets a missing/non-directory start point throw (surfaced as fatal by
  // the caller). A recursive descent that cannot enter a directory is swallowed below.
  const entries = await fs.readdir(dir);

  for (const entry of entries) {
    if (exclude.includes(entry.name)) {
      continue;
    }

    const fullPath = join(dir, entry.name);
    const nameMatches = !re || re.test(entry.name);

    if (entry.isDirectory()) {
      if ((type === 'directory' || type === 'both') && nameMatches) {
        yield { path: fullPath, type: 'dir' };
      }
      try {
        yield* walkLazy(fs, fullPath, options, depth + 1, re, visited);
      } catch {
        // swallowed: a discovery source failing to enter a directory it never named
      }
    } else if (entry.isFile()) {
      if ((type === 'file' || type === 'both') && nameMatches) {
        const { size } = await fs.stat(fullPath);
        yield { path: fullPath, type: 'file', size };
      }
    } else if (entry.isSymbolicLink()) {
      let targetStat: StatResult;
      try {
        targetStat = await fs.stat(fullPath);
      } catch {
        continue; // broken symlink — skip
      }
      const target = await fs.readlink(fullPath);
      if (targetStat.isDirectory()) {
        if ((type === 'directory' || type === 'both') && nameMatches) {
          yield { path: fullPath, type: 'link', target: `${target}/` };
        }
        if (followSymlinks) {
          try {
            yield* walkLazy(fs, fullPath, options, depth + 1, re, visited);
          } catch {
            // swallowed: same as the directory case above
          }
        }
      } else if (targetStat.isFile()) {
        if ((type === 'file' || type === 'both') && nameMatches) {
          yield { path: fullPath, type: 'link', size: targetStat.size, target };
        }
      }
    }
  }
}
