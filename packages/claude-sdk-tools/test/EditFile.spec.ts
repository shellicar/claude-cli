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
    expect(result.diff).toContain(' line one'); // unchanged line before — space-prefixed context
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
    await expect(call(editFile, { patchId: '00000000-0000-4000-8000-000000000000', file: '/any.ts' })).rejects.toThrow('Staged preview not found');
  });
});

describe('regex_text action', () => {
  it('replaces a unique match', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'line one\nline two\nline three' });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, { file: '/file.ts', edits: [{ action: 'regex_text', pattern: 'line two', replacement: 'line TWO' }] });
    expect(result.newContent).toBe('line one\nline TWO\nline three');
  });

  it('replaces a substring within a line, not the whole line', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': "const x: string = 'hello';" });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, { file: '/file.ts', edits: [{ action: 'regex_text', pattern: ': string', replacement: '' }] });
    expect(result.newContent).toBe("const x = 'hello';");
  });

  it('find is treated as a regex pattern', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'version: 42' });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, { file: '/file.ts', edits: [{ action: 'regex_text', pattern: '\\d+', replacement: '99' }] });
    expect(result.newContent).toBe('version: 99');
  });

  it('supports capture groups in replacement', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': "import type { MyType } from 'types';" });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, { file: '/file.ts', edits: [{ action: 'regex_text', pattern: 'import type \\{ (\\w+) \\}', replacement: 'import { $1 }' }] });
    expect(result.newContent).toBe("import { MyType } from 'types';");
  });

  it('$& in replacement inserts the matched text', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'hello world' });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, { file: '/file.ts', edits: [{ action: 'regex_text', pattern: 'world', replacement: '[$&]' }] });
    expect(result.newContent).toBe('hello [world]');
  });

  it('$$ in replacement produces a literal dollar sign', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'cost is 100' });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, { file: '/file.ts', edits: [{ action: 'regex_text', pattern: '100', replacement: '$$100' }] });
    expect(result.newContent).toBe('cost is $100');
  });

  it('matches across multiple lines', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'line one\nline two\nline three' });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, { file: '/file.ts', edits: [{ action: 'regex_text', pattern: 'line one\\nline two', replacement: 'LINES ONE AND TWO' }] });
    expect(result.newContent).toBe('LINES ONE AND TWO\nline three');
  });

  it('includes the old and new text in the diff', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'line one\nline two\nline three' });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, { file: '/file.ts', edits: [{ action: 'regex_text', pattern: 'line two', replacement: 'line TWO' }] });
    expect(result.diff).toContain('line two');
    expect(result.diff).toContain('line TWO');
  });

  it('confirmed edit writes the correct content to disk', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'line one\nline two\nline three' });
    const { previewEdit, editFile } = createEditFilePair(fs);
    const staged = await call(previewEdit, { file: '/file.ts', edits: [{ action: 'regex_text', pattern: 'line two', replacement: 'line TWO' }] });
    await call(editFile, { patchId: staged.patchId, file: staged.file });
    expect(await fs.readFile('/file.ts')).toBe('line one\nline TWO\nline three');
  });

  it('throws when the pattern matches nothing', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'line one\nline two\nline three' });
    const { previewEdit } = createEditFilePair(fs);
    await expect(call(previewEdit, { file: '/file.ts', edits: [{ action: 'regex_text', pattern: 'not in file', replacement: 'x' }] })).rejects.toThrow();
  });

  it('throws when the pattern matches multiple times and replaceMultiple is not set', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'foo\nfoo\nbar' });
    const { previewEdit } = createEditFilePair(fs);
    await expect(call(previewEdit, { file: '/file.ts', edits: [{ action: 'regex_text', pattern: 'foo', replacement: 'baz' }] })).rejects.toThrow('2');
  });

  it('replaces all occurrences across lines when replaceMultiple is true', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'foo\nfoo\nbar' });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, { file: '/file.ts', edits: [{ action: 'regex_text', pattern: 'foo', replacement: 'baz', replaceMultiple: true }] });
    expect(result.newContent).toBe('baz\nbaz\nbar');
  });

  it('replaces all occurrences on the same line when replaceMultiple is true', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'foo foo\nbar' });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, { file: '/file.ts', edits: [{ action: 'regex_text', pattern: 'foo', replacement: 'baz', replaceMultiple: true }] });
    expect(result.newContent).toBe('baz baz\nbar');
  });
});


describe('multiple edits — sequential semantics', () => {
  // Edits are applied in order, top-to-bottom.
  // Each edit's line numbers reference the file *as it looks after all previous edits*,
  // not the original file.

  it('delete then replace: second edit uses post-delete line numbers', async () => {
    // The user's example: delete lines 5–7 from a 10-line file,
    // then the original lines 9–10 are now at positions 6–7.
    const content = '1\n2\n3\n4\n5\n6\n7\n8\n9\n10';
    const fs = new MemoryFileSystem({ '/file.ts': content });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, {
      file: '/file.ts',
      edits: [
        { action: 'delete', startLine: 5, endLine: 7 },     // removes 5,6,7 → [1,2,3,4,8,9,10]
        { action: 'replace', startLine: 6, endLine: 7, content: 'nine\nten' }, // 9,10 are now at 6,7
      ],
    });
    expect(result.newContent).toBe('1\n2\n3\n4\n8\nnine\nten');
  });

  it('insert shifts subsequent edits: second edit uses post-insert line numbers', async () => {
    // Insert a line after line 1 → original line 2 is now at line 3.
    const fs = new MemoryFileSystem({ '/file.ts': 'line one\nline two\nline three' });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, {
      file: '/file.ts',
      edits: [
        { action: 'insert', after_line: 1, content: 'inserted' }, // → [line one, inserted, line two, line three]
        { action: 'replace', startLine: 3, endLine: 3, content: 'line TWO' }, // line two is now at 3
      ],
    });
    expect(result.newContent).toBe('line one\ninserted\nline TWO\nline three');
  });

  it('two consecutive deletes at the same position both use current state', async () => {
    // Delete line 2 twice: first removes B (line 2), second removes C (now line 2).
    const fs = new MemoryFileSystem({ '/file.ts': 'A\nB\nC\nD\nE' });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, {
      file: '/file.ts',
      edits: [
        { action: 'delete', startLine: 2, endLine: 2 }, // removes B → [A,C,D,E]
        { action: 'delete', startLine: 2, endLine: 2 }, // removes C (now line 2) → [A,D,E]
      ],
    });
    expect(result.newContent).toBe('A\nD\nE');
  });

  it('two inserts in sequence: second insert references post-first-insert line numbers', async () => {
    // Insert X after line 1, then insert Y after line 2 (where X now is).
    const fs = new MemoryFileSystem({ '/file.ts': 'A\nB\nC' });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, {
      file: '/file.ts',
      edits: [
        { action: 'insert', after_line: 1, content: 'X' }, // → [A, X, B, C]
        { action: 'insert', after_line: 2, content: 'Y' }, // after X (now line 2) → [A, X, Y, B, C]
      ],
    });
    expect(result.newContent).toBe('A\nX\nY\nB\nC');
  });

  it('replace expanding lines shifts subsequent edits down', async () => {
    // Replace B (line 2) with 3 lines → C shifts from line 3 to line 5.
    const fs = new MemoryFileSystem({ '/file.ts': 'A\nB\nC\nD\nE' });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, {
      file: '/file.ts',
      edits: [
        { action: 'replace', startLine: 2, endLine: 2, content: 'B1\nB2\nB3' }, // → [A,B1,B2,B3,C,D,E]
        { action: 'replace', startLine: 5, endLine: 5, content: 'X' },           // C is now at line 5
      ],
    });
    expect(result.newContent).toBe('A\nB1\nB2\nB3\nX\nD\nE');
  });

  it('replace shrinking lines shifts subsequent edits up', async () => {
    // Replace lines 1–3 with a single line → D shifts from line 4 to line 2.
    const fs = new MemoryFileSystem({ '/file.ts': 'A\nB\nC\nD\nE' });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, {
      file: '/file.ts',
      edits: [
        { action: 'replace', startLine: 1, endLine: 3, content: 'ABC' }, // → [ABC, D, E]
        { action: 'replace', startLine: 2, endLine: 2, content: 'X' },   // D is now at line 2
      ],
    });
    expect(result.newContent).toBe('ABC\nX\nE');
  });

  it('can reference a line that was added by a previous insert', async () => {
    // insert expands the file beyond its original length; the second edit must be valid
    const fs = new MemoryFileSystem({ '/file.ts': 'A\nB\nC' });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, {
      file: '/file.ts',
      edits: [
        { action: 'insert', after_line: 3, content: 'D\nE' }, // → [A,B,C,D,E]
        { action: 'replace', startLine: 4, endLine: 5, content: 'X\nY' }, // line 4,5 only exist post-insert
      ],
    });
    expect(result.newContent).toBe('A\nB\nC\nX\nY');
  });

  it('throws when a subsequent edit references a line removed by a previous delete', async () => {
    // delete shrinks the file; the second edit references a line that no longer exists
    const fs = new MemoryFileSystem({ '/file.ts': 'A\nB\nC\nD\nE' });
    const { previewEdit } = createEditFilePair(fs);
    await expect(call(previewEdit, {
      file: '/file.ts',
      edits: [
        { action: 'delete', startLine: 1, endLine: 4 }, // → [E] (1 line left)
        { action: 'replace', startLine: 3, endLine: 3, content: 'X' }, // line 3 no longer exists
      ],
    })).rejects.toThrow('out of bounds');
  });
});
