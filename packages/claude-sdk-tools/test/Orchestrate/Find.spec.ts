import { describe, expect, it } from 'vitest';
import { createFindLeaf } from '../../src/Orchestrate/leaves/Find.js';
import { MemoryFileSystem } from '../MemoryFileSystem.js';

describe('Find leaf', () => {
  it('is fs.list tier — a directory listing, not a file-content read', () => {
    const leaf = createFindLeaf(new MemoryFileSystem());

    const expected = 'fs.list';
    const actual = leaf.operation;
    expect(actual).toBe(expected);
  });

  it('yields matching paths as plain strings', async () => {
    const fs = new MemoryFileSystem({ '/root/a.txt': 'x', '/root/b.md': 'x' });
    const leaf = createFindLeaf(fs);
    const stderr: string[] = [];

    const { stdout } = leaf.run({ path: '/root', pattern: '\\.txt$' }, undefined, stderr);
    const paths: string[] = [];
    for await (const path of stdout) {
      paths.push(path);
    }

    const expected = ['/root/a.txt'];
    const actual = paths;
    expect(actual).toEqual(expected);
  });

  it('reports success once the walk completes without error', async () => {
    const fs = new MemoryFileSystem({ '/root/a.txt': 'x' });
    const leaf = createFindLeaf(fs);
    const stderr: string[] = [];

    const { stdout, success } = leaf.run({ path: '/root' }, undefined, stderr);
    for await (const _path of stdout) {
      // drain
    }

    const expected = true;
    const actual = success();
    expect(actual).toBe(expected);
  });

  it('reports failure when the start path does not exist', async () => {
    const fs = new MemoryFileSystem();
    const leaf = createFindLeaf(fs);
    const stderr: string[] = [];

    const { stdout, success } = leaf.run({ path: '/missing' }, undefined, stderr);
    for await (const _path of stdout) {
      // drain
    }

    const expected = false;
    const actual = success();
    expect(actual).toBe(expected);
  });

  it('records the error message on stderr when the start path does not exist', async () => {
    const fs = new MemoryFileSystem();
    const leaf = createFindLeaf(fs);
    const stderr: string[] = [];

    const { stdout } = leaf.run({ path: '/missing' }, undefined, stderr);
    for await (const _path of stdout) {
      // drain
    }

    const expected = 1;
    const actual = stderr.length;
    expect(actual).toBe(expected);
  });
});
