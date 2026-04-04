import { homedir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createCreateFile } from '../src/CreateFile/CreateFile';
import { MemoryFileSystem } from '../src/fs/MemoryFileSystem';
import { call } from './helpers';

describe('createCreateFile \u2014 creating new files', () => {
  it('creates a file that did not exist', async () => {
    const fs = new MemoryFileSystem();
    const CreateFile = createCreateFile(fs);
    const result = await call(CreateFile, { path: '/new.ts', content: 'hello' });
    expect(result).toMatchObject({ error: false, path: '/new.ts' });
    expect(await fs.readFile('/new.ts')).toBe('hello');
  });

  it('expands ~ in path', async () => {
    const home = homedir();
    const fs = new MemoryFileSystem();
    const CreateFile = createCreateFile(fs);
    const result = await call(CreateFile, { path: '~/newfile.ts', content: 'hello' });
    expect(result).toMatchObject({ error: false, path: `${home}/newfile.ts` });
    expect(await fs.readFile(`${home}/newfile.ts`)).toBe('hello');
  });

  it('creates a file with empty content when content is omitted', async () => {
    const fs = new MemoryFileSystem();
    const CreateFile = createCreateFile(fs);
    await call(CreateFile, { path: '/empty.ts' });
    expect(await fs.readFile('/empty.ts')).toBe('');
  });

  it('errors when file already exists and overwrite is false (default)', async () => {
    const fs = new MemoryFileSystem({ '/existing.ts': 'original' });
    const CreateFile = createCreateFile(fs);
    const result = await call(CreateFile, { path: '/existing.ts', content: 'new' });
    expect(result).toMatchObject({ error: true, path: '/existing.ts' });
    expect(await fs.readFile('/existing.ts')).toBe('original');
  });
});

describe('createCreateFile \u2014 overwriting existing files', () => {
  it('overwrites a file when overwrite is true', async () => {
    const fs = new MemoryFileSystem({ '/existing.ts': 'original' });
    const CreateFile = createCreateFile(fs);
    const result = await call(CreateFile, { path: '/existing.ts', content: 'updated', overwrite: true });
    expect(result).toMatchObject({ error: false, path: '/existing.ts' });
    expect(await fs.readFile('/existing.ts')).toBe('updated');
  });

  it('errors when overwrite is true but file does not exist', async () => {
    const fs = new MemoryFileSystem();
    const CreateFile = createCreateFile(fs);
    const result = await call(CreateFile, { path: '/missing.ts', content: 'data', overwrite: true });
    expect(result).toMatchObject({ error: true, path: '/missing.ts' });
  });
});
