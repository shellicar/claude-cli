import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createEditFilePair } from '../src/EditFile/createEditFilePair';
import { MemoryFileSystem } from '../src/fs/MemoryFileSystem';
import { call } from './helpers';

const originalContent = 'line one\nline two\nline three';

describe('createPreviewEdit \u2014 staging', () => {
  it('stores a patch in the store and returns a patchId', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': originalContent });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, { file: '/file.ts', edits: [{ action: 'insert', after_line: 0, content: '// header' }] });
    expect(result).toMatchObject({ file: '/file.ts' });
    expect(typeof result.patchId).toBe('string');
  });

  it('computes the correct originalHash', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': originalContent });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, { file: '/file.ts', edits: [{ action: 'delete', startLine: 1, endLine: 1 }] });
    const expected = createHash('sha256').update(originalContent).digest('hex');
    expect(result.originalHash).toBe(expected);
  });

  it('includes a unified diff', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': originalContent });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, { file: '/file.ts', edits: [{ action: 'replace', startLine: 2, endLine: 2, content: 'line TWO' }] });
    expect(result.diff).toContain('line two');
    expect(result.diff).toContain('line TWO');
  });

  it('diff includes context lines around the change', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': originalContent });
    const { previewEdit } = createEditFilePair(fs);
    // originalContent = 'line one\nline two\nline three'; edit middle line only
    const result = await call(previewEdit, { file: '/file.ts', edits: [{ action: 'replace', startLine: 2, endLine: 2, content: 'line TWO' }] });
    expect(result.diff).toContain(' line one');   // unchanged line before — space-prefixed context
    expect(result.diff).toContain(' line three'); // unchanged line after  — space-prefixed context
  });

  it('diff contains a standard @@ hunk header', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': originalContent });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, { file: '/file.ts', edits: [{ action: 'replace', startLine: 2, endLine: 2, content: 'line TWO' }] });
    expect(result.diff).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
  });

  it('expands ~ in file path', async () => {
    const fs = new MemoryFileSystem({ '/home/testuser/file.ts': originalContent }, '/home/testuser');
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, { file: '~/file.ts', edits: [{ action: 'delete', startLine: 1, endLine: 1 }] });
    expect(result.file).toBe('/home/testuser/file.ts');
  });
});

describe('createEditFile \u2014 applying', () => {
  it('applies the patch and writes the new content', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': originalContent });
    const { previewEdit, editFile } = createEditFilePair(fs);
    const staged = await call(previewEdit, { file: '/file.ts', edits: [{ action: 'replace', startLine: 1, endLine: 1, content: 'line ONE' }] });
    const confirmed = await call(editFile, { patchId: staged.patchId, file: staged.file });
    expect(confirmed).toMatchObject({ linesAdded: 1, linesRemoved: 1 });
    expect(await fs.readFile('/file.ts')).toBe('line ONE\nline two\nline three');
  });

  it('throws when the file was modified after staging', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': originalContent });
    const { previewEdit, editFile } = createEditFilePair(fs);
    const staged = await call(previewEdit, { file: '/file.ts', edits: [{ action: 'delete', startLine: 1, endLine: 1 }] });
    await fs.writeFile('/file.ts', 'completely different content');
    await expect(call(editFile, { patchId: staged.patchId, file: staged.file })).rejects.toThrow('has been modified since the edit was staged');
  });

  it('throws when patchId is unknown', async () => {
    const fs = new MemoryFileSystem();
    const { editFile } = createEditFilePair(fs);
    await expect(call(editFile, { patchId: '00000000-0000-4000-8000-000000000000', file: '/any.ts' })).rejects.toThrow('edit_confirm requires a staged edit');
  });
});

describe('replace_text action', () => {
  it('replaces a unique match', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'line one\nline two\nline three' });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, { file: '/file.ts', edits: [{ action: 'replace_text', find: 'line two', replacement: 'line TWO' }] });
    expect(result.newContent).toBe('line one\nline TWO\nline three');
  });

  it('replaces a substring within a line, not the whole line', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': "const x: string = 'hello';" });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, { file: '/file.ts', edits: [{ action: 'replace_text', find: ': string', replacement: '' }] });
    expect(result.newContent).toBe("const x = 'hello';");
  });

  it('find is treated as a regex pattern', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'version: 42' });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, { file: '/file.ts', edits: [{ action: 'replace_text', find: '\\d+', replacement: '99' }] });
    expect(result.newContent).toBe('version: 99');
  });

  it('supports capture groups in replacement', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': "import type { MyType } from 'types';" });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, { file: '/file.ts', edits: [{ action: 'replace_text', find: 'import type \\{ (\\w+) \\}', replacement: 'import { $1 }' }] });
    expect(result.newContent).toBe("import { MyType } from 'types';");
  });

  it('$& in replacement inserts the matched text', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'hello world' });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, { file: '/file.ts', edits: [{ action: 'replace_text', find: 'world', replacement: '[$&]' }] });
    expect(result.newContent).toBe('hello [world]');
  });

  it('$$ in replacement produces a literal dollar sign', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'cost is 100' });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, { file: '/file.ts', edits: [{ action: 'replace_text', find: '100', replacement: '$$100' }] });
    expect(result.newContent).toBe('cost is $100');
  });

  it('matches across multiple lines', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'line one\nline two\nline three' });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, { file: '/file.ts', edits: [{ action: 'replace_text', find: 'line one\\nline two', replacement: 'LINES ONE AND TWO' }] });
    expect(result.newContent).toBe('LINES ONE AND TWO\nline three');
  });

  it('includes the old and new text in the diff', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'line one\nline two\nline three' });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, { file: '/file.ts', edits: [{ action: 'replace_text', find: 'line two', replacement: 'line TWO' }] });
    expect(result.diff).toContain('line two');
    expect(result.diff).toContain('line TWO');
  });

  it('confirmed edit writes the correct content to disk', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'line one\nline two\nline three' });
    const { previewEdit, editFile } = createEditFilePair(fs);
    const staged = await call(previewEdit, { file: '/file.ts', edits: [{ action: 'replace_text', find: 'line two', replacement: 'line TWO' }] });
    await call(editFile, { patchId: staged.patchId, file: staged.file });
    expect(await fs.readFile('/file.ts')).toBe('line one\nline TWO\nline three');
  });

  it('throws when the pattern matches nothing', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'line one\nline two\nline three' });
    const { previewEdit } = createEditFilePair(fs);
    await expect(call(previewEdit, { file: '/file.ts', edits: [{ action: 'replace_text', find: 'not in file', replacement: 'x' }] })).rejects.toThrow();
  });

  it('throws when the pattern matches multiple times and replaceMultiple is not set', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'foo\nfoo\nbar' });
    const { previewEdit } = createEditFilePair(fs);
    await expect(call(previewEdit, { file: '/file.ts', edits: [{ action: 'replace_text', find: 'foo', replacement: 'baz' }] })).rejects.toThrow('2');
  });

  it('replaces all occurrences across lines when replaceMultiple is true', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'foo\nfoo\nbar' });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, { file: '/file.ts', edits: [{ action: 'replace_text', find: 'foo', replacement: 'baz', replaceMultiple: true }] });
    expect(result.newContent).toBe('baz\nbaz\nbar');
  });

  it('replaces all occurrences on the same line when replaceMultiple is true', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'foo foo\nbar' });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, { file: '/file.ts', edits: [{ action: 'replace_text', find: 'foo', replacement: 'baz', replaceMultiple: true }] });
    expect(result.newContent).toBe('baz baz\nbar');
  });
});
