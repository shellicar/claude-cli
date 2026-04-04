import { describe, expect, it } from 'vitest';
import { createCreateFile } from '../src/CreateFile/CreateFile';
import { MemoryFileSystem } from '../src/fs/MemoryFileSystem';

describe('createCreateFile \u2014 creating new files', () => {
  it('creates a file that did not exist', async () => {
    const fs = new MemoryFileSystem();
    const CreateFile = createCreateFile(fs);
    const result = await CreateFile.handler({ path: '/new.ts', content: 'hello' }, new Map());
    expect(result).toMatchObject({ error: false, path: '/new.ts' });
    expect(await fs.readFile('/new.ts')).toBe('hello');
  });

  it('creates a file with empty content when content is omitted', async () => {
    const fs = new MemoryFileSystem();
    const CreateFile = createCreateFile(fs);
    await CreateFile.handler({ path: '/empty.ts' }, new Map());
    expect(await fs.readFile('/empty.ts')).toBe('');
  });

  it('errors when file already exists and overwrite is false (default)', async () => {
    const fs = new MemoryFileSystem({ '/existing.ts': 'original' });
    const CreateFile = createCreateFile(fs);
    const result = await CreateFile.handler({ path: '/existing.ts', content: 'new' }, new Map());
    expect(result).toMatchObject({ error: true, path: '/existing.ts' });
    // File should be unchanged
    expect(await fs.readFile('/existing.ts')).toBe('original');
  });
});

describe('createCreateFile \u2014 overwriting existing files', () => {
  it('overwrites a file when overwrite is true', async () => {
    const fs = new MemoryFileSystem({ '/existing.ts': 'original' });
    const CreateFile = createCreateFile(fs);
    const result = await CreateFile.handler({ path: '/existing.ts', content: 'updated', overwrite: true }, new Map());
    expect(result).toMatchObject({ error: false, path: '/existing.ts' });
    expect(await fs.readFile('/existing.ts')).toBe('updated');
  });

  it('errors when overwrite is true but file does not exist', async () => {
    const fs = new MemoryFileSystem();
    const CreateFile = createCreateFile(fs);
    const result = await CreateFile.handler({ path: '/missing.ts', content: 'data', overwrite: true }, new Map());
    expect(result).toMatchObject({ error: true, path: '/missing.ts' });
  });
});
