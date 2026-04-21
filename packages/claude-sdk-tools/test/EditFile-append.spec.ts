import { describe, expect, it } from 'vitest';
import { createEditFilePair } from '../src/EditFile/createEditFilePair';
import { MemoryFileSystem } from './MemoryFileSystem';
import { call } from './helpers';

describe('append operation', () => {
  it('append adds content after the last line of an existing file', async () => {
    const fs = new MemoryFileSystem({ '/file.jsonl': 'line one\nline two' });
    const { previewEdit, editFile } = createEditFilePair(fs);
    const staged = await call(previewEdit, { file: '/file.jsonl', append: '\nline three' });
    await call(editFile, { patchId: staged.patchId, file: staged.file });
    const actual = await fs.readFile('/file.jsonl');
    const expected = 'line one\nline two\nline three';
    expect(actual).toBe(expected);
  });

  it('append to an empty file writes the content', async () => {
    const fs = new MemoryFileSystem({ '/file.jsonl': '' });
    const { previewEdit, editFile } = createEditFilePair(fs);
    const staged = await call(previewEdit, { file: '/file.jsonl', append: 'new content' });
    await call(editFile, { patchId: staged.patchId, file: staged.file });
    const actual = await fs.readFile('/file.jsonl');
    const expected = 'new content';
    expect(actual).toBe(expected);
  });

  it('existing file content is unchanged when appending', async () => {
    const original = 'line one\nline two';
    const fs = new MemoryFileSystem({ '/file.jsonl': original });
    const { previewEdit, editFile } = createEditFilePair(fs);
    const staged = await call(previewEdit, { file: '/file.jsonl', append: '\nline three' });
    await call(editFile, { patchId: staged.patchId, file: staged.file });
    const actual = await fs.readFile('/file.jsonl');
    expect(actual.slice(0, original.length)).toBe(original);
  });

  it('providing both append and lineEdits produces an error', async () => {
    const fs = new MemoryFileSystem({ '/file.jsonl': 'line one' });
    const { previewEdit } = createEditFilePair(fs);
    const actual = call(previewEdit, {
      file: '/file.jsonl',
      append: '\nline two',
      lineEdits: [{ action: 'insert', after_line: 0, content: 'header' }],
    });
    await expect(actual).rejects.toThrow('append');
  });

  it('providing both append and textEdits produces an error', async () => {
    const fs = new MemoryFileSystem({ '/file.jsonl': 'line one' });
    const { previewEdit } = createEditFilePair(fs);
    const actual = call(previewEdit, {
      file: '/file.jsonl',
      append: '\nline two',
      textEdits: [{ action: 'replace_text', oldString: 'line one', replacement: 'LINE ONE' }],
    });
    await expect(actual).rejects.toThrow('append');
  });

  it('append to a nonexistent file produces an error', async () => {
    const fs = new MemoryFileSystem({});
    const { previewEdit } = createEditFilePair(fs);
    const actual = call(previewEdit, { file: '/nonexistent.jsonl', append: '\nnew line' });
    await expect(actual).rejects.toThrow('ENOENT');
  });
});
