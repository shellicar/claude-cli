import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { homedir as osHomedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { FindOptions, IFileSystem, StatResult } from './IFileSystem';

/**
 * Production filesystem implementation using Node.js fs APIs.
 */
export class NodeFileSystem implements IFileSystem {
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

  public async find(path: string, options?: FindOptions): Promise<string[]> {
    return walk(path, options ?? {}, 1);
  }

  public async stat(path: string): Promise<StatResult> {
    const s = await stat(path);
    return { size: s.size };
  }
}

async function walk(dir: string, options: FindOptions, depth: number): Promise<string[]> {
  const { maxDepth, exclude = [], pattern, type = 'file' } = options;

  if (maxDepth !== undefined && depth > maxDepth) {
    return [];
  }

  const results: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (exclude.includes(entry.name)) {
      continue;
    }

    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (type === 'directory' || type === 'both') {
        if (!pattern || new RegExp(pattern).test(entry.name)) {
          results.push(fullPath);
        }
      }
      results.push(...(await walk(fullPath, options, depth + 1)));
    } else if (entry.isFile()) {
      if (type === 'file' || type === 'both') {
        if (!pattern || new RegExp(pattern).test(entry.name)) {
          results.push(fullPath);
        }
      }
    }
  }

  return results;
}
