import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { FindOptions, IFileSystem } from './IFileSystem';

/**
 * Production filesystem implementation using Node.js fs APIs.
 */
export class NodeFileSystem implements IFileSystem {
  async exists(path: string): Promise<boolean> {
    return existsSync(path);
  }

  async readFile(path: string): Promise<string> {
    return readFile(path, 'utf-8');
  }

  async writeFile(path: string, content: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf-8');
  }

  async deleteFile(path: string): Promise<void> {
    await rm(path);
  }

  async deleteDirectory(path: string): Promise<void> {
    await rmdir(path);
  }

  async find(path: string, options?: FindOptions): Promise<string[]> {
    return walk(path, options ?? {}, 1);
  }
}

async function walk(dir: string, options: FindOptions, depth: number): Promise<string[]> {
  const { maxDepth, exclude = [], pattern, type = 'file' } = options;

  if (maxDepth !== undefined && depth > maxDepth) return [];

  let results: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (exclude.includes(entry.name)) continue;

    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (type === 'directory' || type === 'both') {
        if (!pattern || matchGlob(pattern, entry.name)) {
          results.push(fullPath);
        }
      }
      results.push(...await walk(fullPath, options, depth + 1));
    } else if (entry.isFile()) {
      if (type === 'file' || type === 'both') {
        if (!pattern || matchGlob(pattern, entry.name)) {
          results.push(fullPath);
        }
      }
    }
  }

  return results;
}

function matchGlob(pattern: string, name: string): boolean {
  // Strip leading **/ prefixes — directory traversal is handled by recursion
  const normalised = pattern.replace(/^(\*\*\/)+/, '');
  const escaped = normalised
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`).test(name);
}
