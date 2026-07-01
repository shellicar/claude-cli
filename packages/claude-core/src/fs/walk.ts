import { join } from 'node:path';
import type { FileRecord } from './records';
import type { FindOptions, IFileEntry, StatResult } from './types';

interface WalkFs {
  readdir(path: string): Promise<IFileEntry[]>;
  realpath(path: string): Promise<string>;
  readlink(path: string): Promise<string>;
  stat(path: string): Promise<StatResult>;
}

export async function walk(fs: WalkFs, dir: string, options: FindOptions, depth: number, re: RegExp | undefined, visited: Set<string> = new Set()): Promise<FileRecord[]> {
  const { maxDepth, exclude = [], type = 'file', followSymlinks = true } = options;

  if (maxDepth !== undefined && depth > maxDepth) {
    return [];
  }

  const realDir = await fs.realpath(dir);
  if (visited.has(realDir)) {
    return [];
  }
  visited.add(realDir);

  const results: FileRecord[] = [];
  // The top-level call lets a missing/non-directory start point throw (surfaced as fatal by
  // the source). A recursive descent that cannot enter a directory is swallowed below.
  const entries = await fs.readdir(dir);

  const descend = async (path: string) => {
    try {
      results.push(...(await walk(fs, path, options, depth + 1, re, visited)));
    } catch {
      // swallowed: a discovery source failing to enter a directory it never named
    }
  };

  for (const entry of entries) {
    if (exclude.includes(entry.name)) {
      continue;
    }

    const fullPath = join(dir, entry.name);
    const nameMatches = !re || re.test(entry.name);

    if (entry.isDirectory()) {
      if ((type === 'directory' || type === 'both') && nameMatches) {
        results.push({ path: fullPath, type: 'dir' });
      }
      await descend(fullPath);
    } else if (entry.isFile()) {
      if ((type === 'file' || type === 'both') && nameMatches) {
        const { size } = await fs.stat(fullPath);
        results.push({ path: fullPath, type: 'file', size });
      }
    } else if (entry.isSymbolicLink()) {
      let targetStat: StatResult;
      try {
        targetStat = await fs.stat(fullPath);
      } catch {
        // Broken symlink — skip
        continue;
      }
      const target = await fs.readlink(fullPath);
      if (targetStat.isDirectory()) {
        if ((type === 'directory' || type === 'both') && nameMatches) {
          results.push({ path: fullPath, type: 'link', target: `${target}/` });
        }
        if (followSymlinks) {
          await descend(fullPath);
        }
      } else if (targetStat.isFile()) {
        if ((type === 'file' || type === 'both') && nameMatches) {
          results.push({ path: fullPath, type: 'link', size: targetStat.size, target });
        }
      }
    }
  }

  return results;
}
