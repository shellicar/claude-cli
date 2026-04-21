import { join } from 'node:path';
import type { FindOptions, IFileEntry, StatResult } from './types';

interface WalkFs {
  readdir(path: string): Promise<IFileEntry[]>;
  realpath(path: string): Promise<string>;
  stat(path: string): Promise<StatResult>;
}

export async function walk(fs: WalkFs, dir: string, options: FindOptions, depth: number, re: RegExp | undefined, visited: Set<string> = new Set()): Promise<string[]> {
  const { maxDepth, exclude = [], type = 'file', followSymlinks = true } = options;

  if (maxDepth !== undefined && depth > maxDepth) {
    return [];
  }

  const realDir = await fs.realpath(dir);
  if (visited.has(realDir)) {
    return [];
  }
  visited.add(realDir);

  const results: string[] = [];
  const entries = await fs.readdir(dir);

  for (const entry of entries) {
    if (exclude.includes(entry.name)) {
      continue;
    }

    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (type === 'directory' || type === 'both') {
        if (!re || re.test(entry.name)) {
          results.push(fullPath);
        }
      }
      results.push(...(await walk(fs, fullPath, options, depth + 1, re, visited)));
    } else if (entry.isFile()) {
      if (type === 'file' || type === 'both') {
        if (!re || re.test(entry.name)) {
          results.push(fullPath);
        }
      }
    } else if (entry.isSymbolicLink()) {
      let targetStat: StatResult;
      try {
        targetStat = await fs.stat(fullPath);
      } catch {
        // Broken symlink — skip
        continue;
      }
      if (targetStat.isDirectory()) {
        if (type === 'directory' || type === 'both') {
          if (!re || re.test(entry.name)) {
            results.push(fullPath);
          }
        }
        if (followSymlinks) {
          results.push(...(await walk(fs, fullPath, options, depth + 1, re, visited)));
        }
      } else if (targetStat.isFile()) {
        if (type === 'file' || type === 'both') {
          if (!re || re.test(entry.name)) {
            results.push(fullPath);
          }
        }
      }
    }
  }

  return results;
}
