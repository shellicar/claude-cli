import { existsSync } from 'node:fs';
import { appendFile, mkdir, readdir, readFile, realpath, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { homedir as osHomedir } from 'node:os';
import { dirname, join } from 'node:path';
import { type FindOptions, IFileSystem, type StatResult } from './IFileSystem';

/**
 * Production filesystem implementation using Node.js fs APIs.
 */
export class NodeFileSystem extends IFileSystem {
  public cwd(): string {
    return process.cwd();
  }

  public homedir(): string {
    return osHomedir();
  }

  public async exists(path: string): Promise<boolean> {
    return existsSync(path);
  }

  public async readFile(path: string): Promise<string> {
    return readFile(path, 'utf-8');
  }

  public async writeFile(path: string, content: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf-8');
  }

  public async deleteFile(path: string): Promise<void> {
    await rm(path);
  }

  public async deleteDirectory(path: string): Promise<void> {
    await rmdir(path);
  }

  public async appendFile(path: string, content: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, content, 'utf-8');
  }

  public async find(path: string, options?: FindOptions): Promise<string[]> {
    const re = options?.pattern ? new RegExp(options.pattern) : undefined;
    return walk(path, options ?? {}, 1, re);
  }

  public async stat(path: string): Promise<StatResult> {
    const s = await stat(path);
    return { size: s.size };
  }
}

async function walk(dir: string, options: FindOptions, depth: number, re: RegExp | undefined, visited: Set<string> = new Set()): Promise<string[]> {
  const { maxDepth, exclude = [], type = 'file', followSymlinks = true } = options;

  if (maxDepth !== undefined && depth > maxDepth) {
    return [];
  }

  const realDir = await realpath(dir);
  if (visited.has(realDir)) {
    return [];
  }
  visited.add(realDir);

  const results: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

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
      results.push(...(await walk(fullPath, options, depth + 1, re, visited)));
    } else if (entry.isFile()) {
      if (type === 'file' || type === 'both') {
        if (!re || re.test(entry.name)) {
          results.push(fullPath);
        }
      }
    } else if (entry.isSymbolicLink()) {
      let targetStat: Awaited<ReturnType<typeof stat>>;
      try {
        targetStat = await stat(fullPath);
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
          results.push(...(await walk(fullPath, options, depth + 1, re, visited)));
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
