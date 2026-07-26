import { describe, expect, it } from 'vitest';
import { performCreateFile } from '../../src/CreateFile/performCreateFile.js';
import { MemoryFileSystem } from '../MemoryFileSystem.js';

describe('performCreateFile', () => {
  it('creates a new file with the given content', async () => {
    const fs = new MemoryFileSystem();

    await performCreateFile(fs, '/a.txt', 'hello', false);

    const expected = 'hello';
    const actual = await fs.readFile('/a.txt');
    expect(actual).toBe(expected);
  });

  it('reports ok on a successful create', async () => {
    const fs = new MemoryFileSystem();

    const result = await performCreateFile(fs, '/a.txt', 'hello', false);

    const expected = true;
    const actual = result.ok;
    expect(actual).toBe(expected);
  });

  it('fails when the file already exists and overwrite is false', async () => {
    const fs = new MemoryFileSystem({ '/a.txt': 'existing' });

    const result = await performCreateFile(fs, '/a.txt', 'new', false);

    const expected = false;
    const actual = result.ok;
    expect(actual).toBe(expected);
  });

  it('names the reason when the file already exists', async () => {
    const fs = new MemoryFileSystem({ '/a.txt': 'existing' });

    const result = await performCreateFile(fs, '/a.txt', 'new', false);

    const expected = 'File already exists. Set overwrite: true to replace it.';
    const actual = !result.ok ? result.message : '';
    expect(actual).toBe(expected);
  });

  it('overwrites an existing file when overwrite is true', async () => {
    const fs = new MemoryFileSystem({ '/a.txt': 'old' });

    await performCreateFile(fs, '/a.txt', 'new', true);

    const expected = 'new';
    const actual = await fs.readFile('/a.txt');
    expect(actual).toBe(expected);
  });

  it('fails when overwrite is true but the file does not exist', async () => {
    const fs = new MemoryFileSystem();

    const result = await performCreateFile(fs, '/missing.txt', 'x', true);

    const expected = false;
    const actual = result.ok;
    expect(actual).toBe(expected);
  });
});
