import { describe, expect, it } from 'vitest';
import { createDeleteFile } from '../src/DeleteFile/DeleteFile';
import { MemoryFileSystem } from '../src/fs/MemoryFileSystem';

const files = (values: string[]) => ({ type: 'files' as const, values });

describe('createDeleteFile \u2014 success', () => {
  it('deletes an existing file', async () => {
    const fs = new MemoryFileSystem({ '/a.ts': 'content', '/b.ts': 'other' });
    const DeleteFile = createDeleteFile(fs);
    const result = await DeleteFile.handler({ content: files(['/a.ts']) }, new Map());
    expect(result).toMatchObject({
      deleted: ['/a.ts'],
      errors: [],
      totalDeleted: 1,
      totalErrors: 0,
    });
    expect(await fs.exists('/a.ts')).toBe(false);
    expect(await fs.exists('/b.ts')).toBe(true);
  });

  it('deletes multiple files', async () => {
    const fs = new MemoryFileSystem({ '/a.ts': '', '/b.ts': '', '/c.ts': '' });
    const DeleteFile = createDeleteFile(fs);
    const result = await DeleteFile.handler({ content: files(['/a.ts', '/b.ts']) }, new Map());
    expect(result).toMatchObject({ totalDeleted: 2, totalErrors: 0 });
    expect(await fs.exists('/a.ts')).toBe(false);
    expect(await fs.exists('/b.ts')).toBe(false);
    expect(await fs.exists('/c.ts')).toBe(true);
  });
});

describe('createDeleteFile \u2014 error handling', () => {
  it('reports an error for a missing file without throwing', async () => {
    const fs = new MemoryFileSystem();
    const DeleteFile = createDeleteFile(fs);
    const result = await DeleteFile.handler({ content: files(['/missing.ts']) }, new Map());
    expect(result).toMatchObject({
      deleted: [],
      totalDeleted: 0,
      totalErrors: 1,
    });
    expect(result.errors[0]).toMatchObject({ path: '/missing.ts', error: 'File not found' });
  });

  it('reports errors and successes in the same pass', async () => {
    const fs = new MemoryFileSystem({ '/exists.ts': 'data' });
    const DeleteFile = createDeleteFile(fs);
    const result = await DeleteFile.handler({ content: files(['/exists.ts', '/missing.ts']) }, new Map());
    expect(result).toMatchObject({ totalDeleted: 1, totalErrors: 1 });
    expect(result.deleted).toContain('/exists.ts');
    expect(result.errors[0]).toMatchObject({ path: '/missing.ts' });
  });
});
