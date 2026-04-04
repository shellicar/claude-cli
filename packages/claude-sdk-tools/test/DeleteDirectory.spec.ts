import { describe, expect, it } from 'vitest';
import { createDeleteDirectory } from '../src/DeleteDirectory/DeleteDirectory';
import { MemoryFileSystem } from '../src/fs/MemoryFileSystem';

const files = (values: string[]) => ({ type: 'files' as const, values });

describe('createDeleteDirectory \u2014 success', () => {
  it('deletes an empty directory (implicit, no files inside)', async () => {
    // MemoryFileSystem has a file in /other but not in /empty-dir
    // We can simulate an empty dir by having the dir prefix not match any files.
    // However MemoryFileSystem\'s deleteDirectory just checks for direct children.
    const fs = new MemoryFileSystem({ '/other/file.ts': 'content' });
    const DeleteDirectory = createDeleteDirectory(fs);
    // /empty-dir has no children so deleteDirectory should succeed
    const result = await DeleteDirectory.handler({ content: files(['/empty-dir']) }, new Map());
    expect(result).toMatchObject({
      deleted: ['/empty-dir'],
      errors: [],
      totalDeleted: 1,
      totalErrors: 0,
    });
  });
});

describe('createDeleteDirectory \u2014 error handling', () => {
  it('reports ENOTEMPTY when directory has direct children', async () => {
    const fs = new MemoryFileSystem({ '/dir/file.ts': 'content' });
    const DeleteDirectory = createDeleteDirectory(fs);
    const result = await DeleteDirectory.handler({ content: files(['/dir']) }, new Map());
    expect(result).toMatchObject({
      deleted: [],
      totalDeleted: 0,
      totalErrors: 1,
    });
    expect(result.errors[0]).toMatchObject({
      path: '/dir',
      error: 'Directory is not empty. Delete the files inside first.',
    });
  });

  it('processes multiple paths and reports each outcome', async () => {
    const fs = new MemoryFileSystem({ '/full/file.ts': 'data' });
    const DeleteDirectory = createDeleteDirectory(fs);
    const result = await DeleteDirectory.handler({ content: files(['/empty', '/full']) }, new Map());
    expect(result).toMatchObject({ totalDeleted: 1, totalErrors: 1 });
    expect(result.deleted).toContain('/empty');
    expect(result.errors[0]).toMatchObject({ path: '/full' });
  });
});
