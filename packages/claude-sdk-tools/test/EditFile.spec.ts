import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createEditFilePair } from '../src/EditFile/createEditFilePair';
import { call } from './helpers';
import { MemoryFileSystem } from './MemoryFileSystem';

const originalContent = 'line one\nline two\nline three';

describe('createPreviewEdit — staging', () => {
  it('stores a patch in the store and returns a patchId', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': originalContent });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, { file: '/file.ts', lineEdits: [{ action: 'insert', after_line: 0, content: '// header' }] });
    expect(result).toMatchObject({ file: '/file.ts' });
    expect(typeof result.patchId).toBe('string');
  });

  it('computes the correct originalHash', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': originalContent });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, { file: '/file.ts', lineEdits: [{ action: 'delete', startLine: 1, endLine: 1 }] });
    const expected = createHash('sha256').update(originalContent).digest('hex');
    expect(result.originalHash).toBe(expected);
  });

  it('includes a unified diff', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': originalContent });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, { file: '/file.ts', lineEdits: [{ action: 'replace', startLine: 2, endLine: 2, content: 'line TWO' }] });
    expect(result.diff).toContain('line two');
    expect(result.diff).toContain('line TWO');
  });

  it('diff includes context lines around the change', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': originalContent });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, { file: '/file.ts', lineEdits: [{ action: 'replace', startLine: 2, endLine: 2, content: 'line TWO' }] });
    expect(result.diff).toContain(' line one'); // unchanged line before — space-prefixed context
    expect(result.diff).toContain(' line three'); // unchanged line after  — space-prefixed context
  });

  it('diff contains a standard @@ hunk header', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': originalContent });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, { file: '/file.ts', lineEdits: [{ action: 'replace', startLine: 2, endLine: 2, content: 'line TWO' }] });
    expect(result.diff).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
  });

  it('expands ~ in file path', async () => {
    const fs = new MemoryFileSystem({ '/home/testuser/file.ts': originalContent }, '/home/testuser');
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, { file: '~/file.ts', lineEdits: [{ action: 'delete', startLine: 1, endLine: 1 }] });
    expect(result.file).toBe('/home/testuser/file.ts');
  });
});

describe('createEditFile — applying', () => {
  it('applies the patch and writes the new content', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': originalContent });
    const { previewEdit, editFile } = createEditFilePair(fs);
    const staged = await call(previewEdit, { file: '/file.ts', lineEdits: [{ action: 'replace', startLine: 1, endLine: 1, content: 'line ONE' }] });
    const confirmed = await call(editFile, { patchId: staged.patchId, file: staged.file });
    expect(confirmed).toMatchObject({ linesAdded: 1, linesRemoved: 1 });
    expect(await fs.readFile('/file.ts')).toBe('line ONE\nline two\nline three');
  });

  it('throws when the file was modified after staging', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': originalContent });
    const { previewEdit, editFile } = createEditFilePair(fs);
    const staged = await call(previewEdit, { file: '/file.ts', lineEdits: [{ action: 'delete', startLine: 1, endLine: 1 }] });
    await fs.writeFile('/file.ts', 'completely different content');
    await expect(call(editFile, { patchId: staged.patchId, file: staged.file })).rejects.toThrow('has been modified since the edit was staged');
  });

  it('throws when patchId is unknown', async () => {
    const fs = new MemoryFileSystem();
    const { editFile } = createEditFilePair(fs);
    await expect(call(editFile, { patchId: '00000000-0000-4000-8000-000000000000', file: '/any.ts' })).rejects.toThrow('Staged preview not found');
  });

  it('accepts a ~ path when the patch was staged with the expanded path', async () => {
    const fs = new MemoryFileSystem({ '/home/testuser/file.ts': originalContent }, '/home/testuser');
    const { previewEdit, editFile } = createEditFilePair(fs);
    const staged = await call(previewEdit, { file: '/home/testuser/file.ts', lineEdits: [{ action: 'replace', startLine: 1, endLine: 1, content: 'line ONE' }] });
    const confirmed = await call(editFile, { patchId: staged.patchId, file: '~/file.ts' });
    expect(confirmed).toMatchObject({ linesAdded: 1, linesRemoved: 1 });
    expect(await fs.readFile('/home/testuser/file.ts')).toBe('line ONE\nline two\nline three');
  });

  it('accepts a ~ path when both preview and edit use ~', async () => {
    const fs = new MemoryFileSystem({ '/home/testuser/file.ts': originalContent }, '/home/testuser');
    const { previewEdit, editFile } = createEditFilePair(fs);
    const staged = await call(previewEdit, { file: '~/file.ts', lineEdits: [{ action: 'replace', startLine: 1, endLine: 1, content: 'line ONE' }] });
    const confirmed = await call(editFile, { patchId: staged.patchId, file: '~/file.ts' });
    expect(confirmed).toMatchObject({ linesAdded: 1, linesRemoved: 1 });
    expect(await fs.readFile('/home/testuser/file.ts')).toBe('line ONE\nline two\nline three');
  });
});

describe('regex_text action', () => {
  it('replaces a unique match', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'line one\nline two\nline three' });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, { file: '/file.ts', textEdits: [{ action: 'regex_text', pattern: 'line two', replacement: 'line TWO' }] });
    expect(result.newContent).toBe('line one\nline TWO\nline three');
  });

  it('replaces a substring within a line, not the whole line', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': "const x: string = 'hello';" });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, { file: '/file.ts', textEdits: [{ action: 'regex_text', pattern: ': string', replacement: '' }] });
    expect(result.newContent).toBe("const x = 'hello';");
  });

  it('find is treated as a regex pattern', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'version: 42' });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, { file: '/file.ts', textEdits: [{ action: 'regex_text', pattern: '\\d+', replacement: '99' }] });
    expect(result.newContent).toBe('version: 99');
  });

  it('supports capture groups in replacement', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': "import type { MyType } from 'types';" });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, { file: '/file.ts', textEdits: [{ action: 'regex_text', pattern: 'import type \\{ (\\w+) \\}', replacement: 'import { $1 }' }] });
    expect(result.newContent).toBe("import { MyType } from 'types';");
  });

  it('$& in replacement inserts the matched text', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'hello world' });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, { file: '/file.ts', textEdits: [{ action: 'regex_text', pattern: 'world', replacement: '[$&]' }] });
    expect(result.newContent).toBe('hello [world]');
  });

  it('$$ in replacement produces a literal dollar sign', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'cost is 100' });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, { file: '/file.ts', textEdits: [{ action: 'regex_text', pattern: '100', replacement: '$$100' }] });
    expect(result.newContent).toBe('cost is $100');
  });

  it('matches across multiple lines', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'line one\nline two\nline three' });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, { file: '/file.ts', textEdits: [{ action: 'regex_text', pattern: 'line one\\nline two', replacement: 'LINES ONE AND TWO' }] });
    expect(result.newContent).toBe('LINES ONE AND TWO\nline three');
  });

  it('includes the old and new text in the diff', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'line one\nline two\nline three' });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, { file: '/file.ts', textEdits: [{ action: 'regex_text', pattern: 'line two', replacement: 'line TWO' }] });
    expect(result.diff).toContain('line two');
    expect(result.diff).toContain('line TWO');
  });

  it('confirmed edit writes the correct content to disk', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'line one\nline two\nline three' });
    const { previewEdit, editFile } = createEditFilePair(fs);
    const staged = await call(previewEdit, { file: '/file.ts', textEdits: [{ action: 'regex_text', pattern: 'line two', replacement: 'line TWO' }] });
    await call(editFile, { patchId: staged.patchId, file: staged.file });
    expect(await fs.readFile('/file.ts')).toBe('line one\nline TWO\nline three');
  });

  it('throws when the pattern matches nothing', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'line one\nline two\nline three' });
    const { previewEdit } = createEditFilePair(fs);
    await expect(call(previewEdit, { file: '/file.ts', textEdits: [{ action: 'regex_text', pattern: 'not in file', replacement: 'x' }] })).rejects.toThrow();
  });

  it('throws when the pattern matches multiple times and replaceMultiple is not set', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'foo\nfoo\nbar' });
    const { previewEdit } = createEditFilePair(fs);
    await expect(call(previewEdit, { file: '/file.ts', textEdits: [{ action: 'regex_text', pattern: 'foo', replacement: 'baz' }] })).rejects.toThrow('2');
  });

  it('replaces all occurrences across lines when replaceMultiple is true', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'foo\nfoo\nbar' });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, { file: '/file.ts', textEdits: [{ action: 'regex_text', pattern: 'foo', replacement: 'baz', replaceMultiple: true }] });
    expect(result.newContent).toBe('baz\nbaz\nbar');
  });

  it('replaces all occurrences on the same line when replaceMultiple is true', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'foo foo\nbar' });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, { file: '/file.ts', textEdits: [{ action: 'regex_text', pattern: 'foo', replacement: 'baz', replaceMultiple: true }] });
    expect(result.newContent).toBe('baz baz\nbar');
  });
});

describe('replace_text action', () => {
  it('replaces a unique literal string match', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'line one\nline two\nline three' });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, { file: '/file.ts', textEdits: [{ action: 'replace_text', oldString: 'line two', replacement: 'line TWO' }] });
    expect(result.newContent).toBe('line one\nline TWO\nline three');
  });

  it('treats special regex chars in oldString as literals', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'price: (100)' });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, { file: '/file.ts', textEdits: [{ action: 'replace_text', oldString: '(100)', replacement: '(200)' }] });
    expect(result.newContent).toBe('price: (200)');
  });

  it('treats $ in replacement as a literal dollar sign, not a special pattern', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'cost: 100' });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, { file: '/file.ts', textEdits: [{ action: 'replace_text', oldString: '100', replacement: '$100' }] });
    expect(result.newContent).toBe('cost: $100');
  });

  it('$$ in replacement produces two dollar signs, not one', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'x' });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, { file: '/file.ts', textEdits: [{ action: 'replace_text', oldString: 'x', replacement: '$$' }] });
    expect(result.newContent).toBe('$$');
  });

  it('$& in replacement is literal, not the matched text', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'hello world' });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, { file: '/file.ts', textEdits: [{ action: 'replace_text', oldString: 'world', replacement: '$&' }] });
    expect(result.newContent).toBe('hello $&');
  });

  it('throws when oldString is not found', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'line one' });
    const { previewEdit } = createEditFilePair(fs);
    await expect(call(previewEdit, { file: '/file.ts', textEdits: [{ action: 'replace_text', oldString: 'not here', replacement: 'x' }] })).rejects.toThrow();
  });

  it('replaces all occurrences when replaceMultiple is true', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'foo\nfoo\nbar' });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, { file: '/file.ts', textEdits: [{ action: 'replace_text', oldString: 'foo', replacement: 'baz', replaceMultiple: true }] });
    expect(result.newContent).toBe('baz\nbaz\nbar');
  });
});

describe('lineEdits — bottom-to-top semantics', () => {
  // All line numbers reference the file as it exists before the call.
  // The tool sorts edits bottom-to-top internally before applying them,
  // so earlier edits never shift the line numbers of later ones.

  it('two non-overlapping replaces both reference original line numbers', async () => {
    // A=1, B=2, C=3, D=4, E=5
    const fs = new MemoryFileSystem({ '/file.ts': 'A\nB\nC\nD\nE' });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, {
      file: '/file.ts',
      lineEdits: [
        { action: 'replace', startLine: 2, endLine: 2, content: 'XX' }, // B → XX (original line 2)
        { action: 'replace', startLine: 4, endLine: 4, content: 'YY' }, // D → YY (original line 4)
      ],
    });
    expect(result.newContent).toBe('A\nXX\nC\nYY\nE');
  });

  it('specification order does not affect the result', async () => {
    // Same edits as above but reversed — must produce identical output.
    const fs = new MemoryFileSystem({ '/file.ts': 'A\nB\nC\nD\nE' });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, {
      file: '/file.ts',
      lineEdits: [
        { action: 'replace', startLine: 4, endLine: 4, content: 'YY' },
        { action: 'replace', startLine: 2, endLine: 2, content: 'XX' },
      ],
    });
    expect(result.newContent).toBe('A\nXX\nC\nYY\nE');
  });

  it('insert and replace both reference the original file, not each other', async () => {
    // Original: line one(1) / line two(2) / line three(3)
    // insert after_line 1 adds a line between line one and line two.
    // replace line 3 replaces line three — line 3 in the ORIGINAL, not post-insert.
    const fs = new MemoryFileSystem({ '/file.ts': 'line one\nline two\nline three' });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, {
      file: '/file.ts',
      lineEdits: [
        { action: 'insert', after_line: 1, content: 'inserted' },
        { action: 'replace', startLine: 3, endLine: 3, content: 'line THREE' },
      ],
    });
    expect(result.newContent).toBe('line one\ninserted\nline two\nline THREE');
  });

  it('two inserts at different positions both reference the original file', async () => {
    // Original: A(1) B(2) C(3)
    // Insert after 1 → between A and B
    // Insert after 3 → after C
    // Both after_line values are from the original.
    const fs = new MemoryFileSystem({ '/file.ts': 'A\nB\nC' });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, {
      file: '/file.ts',
      lineEdits: [
        { action: 'insert', after_line: 1, content: 'after-A' },
        { action: 'insert', after_line: 3, content: 'after-C' },
      ],
    });
    expect(result.newContent).toBe('A\nafter-A\nB\nC\nafter-C');
  });

  it('delete and replace on non-overlapping lines both reference original', async () => {
    // Delete line 2, replace line 4 — both from original.
    const fs = new MemoryFileSystem({ '/file.ts': 'A\nB\nC\nD\nE' });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, {
      file: '/file.ts',
      lineEdits: [
        { action: 'delete', startLine: 2, endLine: 2 },
        { action: 'replace', startLine: 4, endLine: 4, content: 'DD' },
      ],
    });
    expect(result.newContent).toBe('A\nC\nDD\nE');
  });

  it('throws when two edits target overlapping lines', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'A\nB\nC\nD\nE' });
    const { previewEdit } = createEditFilePair(fs);
    await expect(
      call(previewEdit, {
        file: '/file.ts',
        lineEdits: [
          { action: 'replace', startLine: 2, endLine: 3, content: 'X' },
          { action: 'replace', startLine: 3, endLine: 4, content: 'Y' },
        ],
      }),
    ).rejects.toThrow();
  });

  it('throws when a line number is beyond the end of the file', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'A\nB\nC' }); // 3 lines
    const { previewEdit } = createEditFilePair(fs);
    await expect(
      call(previewEdit, {
        file: '/file.ts',
        lineEdits: [{ action: 'replace', startLine: 5, endLine: 5, content: 'X' }],
      }),
    ).rejects.toThrow('out of bounds');
  });
});

describe('lineEdits + textEdits — combined', () => {
  // textEdits are applied after all lineEdits complete.
  // They search the post-lineEdit content, not the original.

  it('textEdits see the content after lineEdits are applied', async () => {
    // This is the key regression test for the bug that motivated the redesign.
    // Previously, combining an insert + replace_text in one call would land the
    // replacement N lines too early because text ops ran against the original positions.
    //
    // Original: line one / line two / line three
    // lineEdit: insert '// generated' before line 1 (after_line: 0)
    // textEdit: replace 'line two' → 'line TWO'
    // Expected: // generated / line one / line TWO / line three
    const fs = new MemoryFileSystem({ '/file.ts': 'line one\nline two\nline three' });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, {
      file: '/file.ts',
      lineEdits: [{ action: 'insert', after_line: 0, content: '// generated' }],
      textEdits: [{ action: 'replace_text', oldString: 'line two', replacement: 'line TWO' }],
    });
    expect(result.newContent).toBe('// generated\nline one\nline TWO\nline three');
  });

  it('multiple textEdits are applied in order after all lineEdits', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'foo\nbar\nbaz' });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, {
      file: '/file.ts',
      lineEdits: [{ action: 'replace', startLine: 1, endLine: 1, content: 'FOO' }],
      textEdits: [
        { action: 'replace_text', oldString: 'bar', replacement: 'BAR' },
        { action: 'replace_text', oldString: 'baz', replacement: 'BAZ' },
      ],
    });
    expect(result.newContent).toBe('FOO\nBAR\nBAZ');
  });

  it('textEdit can match a string that only exists after the lineEdit inserts it', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'hello world' });
    const { previewEdit } = createEditFilePair(fs);
    const result = await call(previewEdit, {
      file: '/file.ts',
      lineEdits: [{ action: 'insert', after_line: 1, content: 'inserted line' }],
      textEdits: [{ action: 'replace_text', oldString: 'inserted line', replacement: 'INSERTED LINE' }],
    });
    expect(result.newContent).toBe('hello world\nINSERTED LINE');
  });
});

describe('chained previews — previousPatchId', () => {
  it('uses the previous patch newContent as the base', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'line one\nline two\nline three' });
    const { previewEdit } = createEditFilePair(fs);
    const patch1 = await call(previewEdit, {
      file: '/file.ts',
      textEdits: [{ action: 'replace_text', oldString: 'line two', replacement: 'LINE TWO' }],
    });
    const patch2 = await call(previewEdit, {
      file: '/file.ts',
      textEdits: [{ action: 'replace_text', oldString: 'line three', replacement: 'LINE THREE' }],
      previousPatchId: patch1.patchId,
    });
    expect(patch2.newContent).toBe('line one\nLINE TWO\nLINE THREE');
  });

  it('inherits originalHash from the first patch so EditFile can validate the disk', async () => {
    const content = 'line one\nline two\nline three';
    const fs = new MemoryFileSystem({ '/file.ts': content });
    const { previewEdit } = createEditFilePair(fs);
    const patch1 = await call(previewEdit, {
      file: '/file.ts',
      textEdits: [{ action: 'replace_text', oldString: 'line one', replacement: 'LINE ONE' }],
    });
    const patch2 = await call(previewEdit, {
      file: '/file.ts',
      textEdits: [{ action: 'replace_text', oldString: 'line two', replacement: 'LINE TWO' }],
      previousPatchId: patch1.patchId,
    });
    expect(patch2.originalHash).toBe(patch1.originalHash);
  });

  it('diff is incremental — only shows the delta introduced by this patch', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'line one\nline two\nline three' });
    const { previewEdit } = createEditFilePair(fs);
    const patch1 = await call(previewEdit, {
      file: '/file.ts',
      textEdits: [{ action: 'replace_text', oldString: 'line one', replacement: 'LINE ONE' }],
    });
    const patch2 = await call(previewEdit, {
      file: '/file.ts',
      textEdits: [{ action: 'replace_text', oldString: 'line three', replacement: 'LINE THREE' }],
      previousPatchId: patch1.patchId,
    });
    // patch2 diff should not show line one as a changed line (it's already settled in patch1)
    const changedLines = patch2.diff.split('\n').filter((l) => l.startsWith('+') || l.startsWith('-'));
    expect(changedLines.join('\n')).not.toContain('line one');
    expect(changedLines.join('\n')).not.toContain('LINE ONE');
    // but should show the line three change
    expect(patch2.diff).toContain('line three');
    expect(patch2.diff).toContain('LINE THREE');
  });

  it('EditFile applies the fully accumulated result when given the final patch', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'line one\nline two\nline three' });
    const { previewEdit, editFile } = createEditFilePair(fs);
    const patch1 = await call(previewEdit, {
      file: '/file.ts',
      textEdits: [{ action: 'replace_text', oldString: 'line one', replacement: 'LINE ONE' }],
    });
    const patch2 = await call(previewEdit, {
      file: '/file.ts',
      textEdits: [{ action: 'replace_text', oldString: 'line two', replacement: 'LINE TWO' }],
      previousPatchId: patch1.patchId,
    });
    await call(editFile, { patchId: patch2.patchId, file: patch2.file });
    expect(await fs.readFile('/file.ts')).toBe('LINE ONE\nLINE TWO\nline three');
  });

  it('can also EditFile at an intermediate patch (rollback point)', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'line one\nline two\nline three' });
    const { previewEdit, editFile } = createEditFilePair(fs);
    const patch1 = await call(previewEdit, {
      file: '/file.ts',
      textEdits: [{ action: 'replace_text', oldString: 'line one', replacement: 'LINE ONE' }],
    });
    // build patch2 but don't apply it
    await call(previewEdit, {
      file: '/file.ts',
      textEdits: [{ action: 'replace_text', oldString: 'line two', replacement: 'LINE TWO' }],
      previousPatchId: patch1.patchId,
    });
    // apply only patch1
    await call(editFile, { patchId: patch1.patchId, file: patch1.file });
    expect(await fs.readFile('/file.ts')).toBe('LINE ONE\nline two\nline three');
  });

  it('throws when previousPatchId does not exist in store', async () => {
    const fs = new MemoryFileSystem({ '/file.ts': 'hello' });
    const { previewEdit } = createEditFilePair(fs);
    await expect(
      call(previewEdit, {
        file: '/file.ts',
        textEdits: [{ action: 'replace_text', oldString: 'hello', replacement: 'world' }],
        previousPatchId: '00000000-0000-4000-8000-000000000000',
      }),
    ).rejects.toThrow('Previous patch not found');
  });

  it('throws when previousPatchId is for a different file', async () => {
    const fs = new MemoryFileSystem({ '/a.ts': 'hello', '/b.ts': 'world' });
    const { previewEdit } = createEditFilePair(fs);
    const patch1 = await call(previewEdit, {
      file: '/a.ts',
      textEdits: [{ action: 'replace_text', oldString: 'hello', replacement: 'HELLO' }],
    });
    await expect(
      call(previewEdit, {
        file: '/b.ts',
        textEdits: [{ action: 'replace_text', oldString: 'world', replacement: 'WORLD' }],
        previousPatchId: patch1.patchId,
      }),
    ).rejects.toThrow('File mismatch');
  });
});
