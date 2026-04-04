import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createConfirmEditFile } from '../src/EditFile/ConfirmEditFile';
import { createEditFile } from '../src/EditFile/EditFile';
import { MemoryFileSystem } from '../src/fs/MemoryFileSystem';
import { call } from './helpers';

const originalContent = 'line one\nline two\nline three';

describe('createEditFile — staging', () => {
  it('stores a patch in the store and returns a patchId', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': originalContent });
    const EditFile = createEditFile(fs);
    const store = new Map();
    const result = await call(EditFile, { file: '/file.ts', edits: [{ action: 'insert', after_line: 0, content: '// header' }] }, store);
    expect(result).toMatchObject({ file: '/file.ts' });
    expect(typeof result.patchId).toBe('string');
    expect(store.has(result.patchId)).toBe(true);
  });

  it('computes the correct originalHash', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': originalContent });
    const EditFile = createEditFile(fs);
    const result = await call(EditFile, { file: '/file.ts', edits: [{ action: 'delete', startLine: 1, endLine: 1 }] });
    const expected = createHash('sha256').update(originalContent).digest('hex');
    expect(result.originalHash).toBe(expected);
  });

  it('includes a unified diff', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': originalContent });
    const EditFile = createEditFile(fs);
    const result = await call(EditFile, { file: '/file.ts', edits: [{ action: 'replace', startLine: 2, endLine: 2, content: 'line TWO' }] });
    expect(result.diff).toContain('line two');
    expect(result.diff).toContain('line TWO');
  });
});

describe('createConfirmEditFile — applying', () => {
  it('applies the patch and writes the new content', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': originalContent });
    const EditFile = createEditFile(fs);
    const ConfirmEditFile = createConfirmEditFile(fs);
    const store = new Map();
    const staged = await call(EditFile, { file: '/file.ts', edits: [{ action: 'replace', startLine: 1, endLine: 1, content: 'line ONE' }] }, store);
    const confirmed = await call(ConfirmEditFile, { patchId: staged.patchId, file: staged.file }, store);
    expect(confirmed).toMatchObject({ linesChanged: 0 });
    expect(await fs.readFile('/file.ts')).toBe('line ONE\nline two\nline three');
  });

  it('throws when the file was modified after staging', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': originalContent });
    const EditFile = createEditFile(fs);
    const ConfirmEditFile = createConfirmEditFile(fs);
    const store = new Map();
    const staged = await call(EditFile, { file: '/file.ts', edits: [{ action: 'delete', startLine: 1, endLine: 1 }] }, store);
    await fs.writeFile('/file.ts', 'completely different content');
    await expect(call(ConfirmEditFile, { patchId: staged.patchId, file: staged.file }, store)).rejects.toThrow(
      'has been modified since the edit was staged',
    );
  });

  it('throws when patchId is unknown', async () => {
    const fs = new MemoryFileSystem();
    const ConfirmEditFile = createConfirmEditFile(fs);
    await expect(
      call(ConfirmEditFile, { patchId: '00000000-0000-4000-8000-000000000000', file: '/any.ts' }),
    ).rejects.toThrow('edit_confirm requires a staged edit');
  });
});
