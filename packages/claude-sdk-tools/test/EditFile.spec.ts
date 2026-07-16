import { describe, expect, it } from 'vitest';
import { createEditFile } from '../src/EditFile/EditFile';
import { call } from './helpers';
import { MemoryFileSystem } from './MemoryFileSystem';

describe('EditFile', () => {
  it('writes the edited content to disk', async () => {
    const fs = new MemoryFileSystem({ '/a.ts': 'one\ntwo\nthree' });
    const editFile = createEditFile(fs);
    await call(editFile, { file: '/a.ts', lineEdits: [{ action: 'replace', startLine: 2, endLine: 2, content: 'TWO' }] });
    const actual = await fs.readFile('/a.ts');
    expect(actual).toBe('one\nTWO\nthree');
  });

  it('returns a plain-text diff, not JSON', async () => {
    const fs = new MemoryFileSystem({ '/a.ts': 'one\ntwo\nthree' });
    const editFile = createEditFile(fs);
    const actual = await call(editFile, { file: '/a.ts', lineEdits: [{ action: 'replace', startLine: 2, endLine: 2, content: 'TWO' }] });
    expect(typeof actual).toBe('string');
  });

  it('numbers a changed line with the new file\u2019s line number', async () => {
    const fs = new MemoryFileSystem({ '/a.ts': 'one\ntwo\nthree' });
    const editFile = createEditFile(fs);
    const actual = await call(editFile, { file: '/a.ts', lineEdits: [{ action: 'replace', startLine: 2, endLine: 2, content: 'TWO' }] });
    expect(actual).toContain('+2:TWO');
  });

  it('numbers a removed line with the original file\u2019s line number', async () => {
    const fs = new MemoryFileSystem({ '/a.ts': 'one\ntwo\nthree' });
    const editFile = createEditFile(fs);
    const actual = await call(editFile, { file: '/a.ts', lineEdits: [{ action: 'replace', startLine: 2, endLine: 2, content: 'TWO' }] });
    expect(actual).toContain('-2:two');
  });

  describe('lineEdits \u2014 insert', () => {
    it('inserts after the given line', async () => {
      const fs = new MemoryFileSystem({ '/a.ts': 'one\ntwo' });
      const editFile = createEditFile(fs);
      await call(editFile, { file: '/a.ts', lineEdits: [{ action: 'insert', after_line: 1, content: 'inserted' }] });
      const actual = await fs.readFile('/a.ts');
      expect(actual).toBe('one\ninserted\ntwo');
    });

    it('inserts at the top when after_line is 0', async () => {
      const fs = new MemoryFileSystem({ '/a.ts': 'one\ntwo' });
      const editFile = createEditFile(fs);
      await call(editFile, { file: '/a.ts', lineEdits: [{ action: 'insert', after_line: 0, content: 'top' }] });
      const actual = await fs.readFile('/a.ts');
      expect(actual).toBe('top\none\ntwo');
    });

    it('inserts after the last line when after_line is -1', async () => {
      const fs = new MemoryFileSystem({ '/a.ts': 'one\ntwo' });
      const editFile = createEditFile(fs);
      await call(editFile, { file: '/a.ts', lineEdits: [{ action: 'insert', after_line: -1, content: 'appended' }] });
      const actual = await fs.readFile('/a.ts');
      expect(actual).toBe('one\ntwo\nappended');
    });

    it('inserts before the last line when after_line is -2', async () => {
      const fs = new MemoryFileSystem({ '/a.ts': 'one\ntwo\nthree' });
      const editFile = createEditFile(fs);
      await call(editFile, { file: '/a.ts', lineEdits: [{ action: 'insert', after_line: -2, content: 'middle' }] });
      const actual = await fs.readFile('/a.ts');
      expect(actual).toBe('one\ntwo\nmiddle\nthree');
    });

    it('throws when a negative after_line resolves before the start of the file', async () => {
      const fs = new MemoryFileSystem({ '/a.ts': 'one\ntwo' });
      const editFile = createEditFile(fs);
      await expect(call(editFile, { file: '/a.ts', lineEdits: [{ action: 'insert', after_line: -5, content: 'x' }] })).rejects.toThrow('out of bounds');
    });
  });

  describe('lineEdits \u2014 delete', () => {
    it('deletes the given line range', async () => {
      const fs = new MemoryFileSystem({ '/a.ts': 'one\ntwo\nthree' });
      const editFile = createEditFile(fs);
      await call(editFile, { file: '/a.ts', lineEdits: [{ action: 'delete', startLine: 2, endLine: 2 }] });
      const actual = await fs.readFile('/a.ts');
      expect(actual).toBe('one\nthree');
    });
  });

  describe('lineEdits \u2014 validation', () => {
    it('throws when startLine is out of bounds', async () => {
      const fs = new MemoryFileSystem({ '/a.ts': 'one\ntwo' });
      const editFile = createEditFile(fs);
      await expect(call(editFile, { file: '/a.ts', lineEdits: [{ action: 'delete', startLine: 5, endLine: 5 }] })).rejects.toThrow('out of bounds');
    });

    it('throws when startLine is greater than endLine', async () => {
      const fs = new MemoryFileSystem({ '/a.ts': 'one\ntwo\nthree' });
      const editFile = createEditFile(fs);
      await expect(call(editFile, { file: '/a.ts', lineEdits: [{ action: 'delete', startLine: 3, endLine: 1 }] })).rejects.toThrow('greater than endLine');
    });

    it('throws when two edits target overlapping lines', async () => {
      const fs = new MemoryFileSystem({ '/a.ts': 'one\ntwo\nthree' });
      const editFile = createEditFile(fs);
      const edits = [
        { action: 'delete' as const, startLine: 1, endLine: 2 },
        { action: 'replace' as const, startLine: 2, endLine: 3, content: 'x' },
      ];
      await expect(call(editFile, { file: '/a.ts', lineEdits: edits })).rejects.toThrow('overlap');
    });

    it('applies multiple non-overlapping edits bottom-to-top without needing offset math', async () => {
      const fs = new MemoryFileSystem({ '/a.ts': 'one\ntwo\nthree\nfour' });
      const editFile = createEditFile(fs);
      const edits = [
        { action: 'delete' as const, startLine: 1, endLine: 1 },
        { action: 'replace' as const, startLine: 3, endLine: 3, content: 'THREE' },
      ];
      await call(editFile, { file: '/a.ts', lineEdits: edits });
      const actual = await fs.readFile('/a.ts');
      expect(actual).toBe('two\nTHREE\nfour');
    });
  });

  describe('textEdits \u2014 replace_text', () => {
    it('replaces a literal string', async () => {
      const fs = new MemoryFileSystem({ '/a.ts': 'const x = 1;' });
      const editFile = createEditFile(fs);
      await call(editFile, { file: '/a.ts', textEdits: [{ action: 'replace_text', oldString: 'const x', replacement: 'let x' }] });
      const actual = await fs.readFile('/a.ts');
      expect(actual).toBe('let x = 1;');
    });

    it('treats the replacement as literal text, not a $-pattern', async () => {
      const fs = new MemoryFileSystem({ '/a.ts': 'foo' });
      const editFile = createEditFile(fs);
      await call(editFile, { file: '/a.ts', textEdits: [{ action: 'replace_text', oldString: 'foo', replacement: '$&$1' }] });
      const actual = await fs.readFile('/a.ts');
      expect(actual).toBe('$&$1');
    });

    it('treats the search string as literal text, not a regex', async () => {
      const fs = new MemoryFileSystem({ '/a.ts': 'a.b.c' });
      const editFile = createEditFile(fs);
      await call(editFile, { file: '/a.ts', textEdits: [{ action: 'replace_text', oldString: 'a.b', replacement: 'X' }] });
      const actual = await fs.readFile('/a.ts');
      expect(actual).toBe('X.c');
    });

    it('throws when the string is not found', async () => {
      const fs = new MemoryFileSystem({ '/a.ts': 'foo' });
      const editFile = createEditFile(fs);
      await expect(call(editFile, { file: '/a.ts', textEdits: [{ action: 'replace_text', oldString: 'missing', replacement: 'x' }] })).rejects.toThrow('not found');
    });

    it('throws when the string matches more than once without replaceMultiple', async () => {
      const fs = new MemoryFileSystem({ '/a.ts': 'foo foo' });
      const editFile = createEditFile(fs);
      await expect(call(editFile, { file: '/a.ts', textEdits: [{ action: 'replace_text', oldString: 'foo', replacement: 'x' }] })).rejects.toThrow('matched 2 times');
    });

    it('replaces every match when replaceMultiple is true', async () => {
      const fs = new MemoryFileSystem({ '/a.ts': 'foo foo' });
      const editFile = createEditFile(fs);
      await call(editFile, { file: '/a.ts', textEdits: [{ action: 'replace_text', oldString: 'foo', replacement: 'x', replaceMultiple: true }] });
      const actual = await fs.readFile('/a.ts');
      expect(actual).toBe('x x');
    });

    it('includes the edit index in a not-found error', async () => {
      const fs = new MemoryFileSystem({ '/a.ts': 'foo' });
      const editFile = createEditFile(fs);
      const edits = [
        { action: 'replace_text' as const, oldString: 'foo', replacement: 'bar' },
        { action: 'replace_text' as const, oldString: 'foo', replacement: 'baz' },
      ];
      await expect(call(editFile, { file: '/a.ts', textEdits: edits })).rejects.toThrow('textEdits[1]');
    });
  });

  describe('textEdits \u2014 regex_text', () => {
    it('replaces using a regex pattern', async () => {
      const fs = new MemoryFileSystem({ '/a.ts': 'import type { Foo }' });
      const editFile = createEditFile(fs);
      await call(editFile, { file: '/a.ts', textEdits: [{ action: 'regex_text', pattern: 'import type \\{ (\\w+) \\}', replacement: 'import { $1 }' }] });
      const actual = await fs.readFile('/a.ts');
      expect(actual).toBe('import { Foo }');
    });

    it('throws when the pattern is not found', async () => {
      const fs = new MemoryFileSystem({ '/a.ts': 'foo' });
      const editFile = createEditFile(fs);
      await expect(call(editFile, { file: '/a.ts', textEdits: [{ action: 'regex_text', pattern: 'missing', replacement: 'x' }] })).rejects.toThrow('not found');
    });

    it('throws when the pattern matches more than once without replaceMultiple', async () => {
      const fs = new MemoryFileSystem({ '/a.ts': 'foo foo' });
      const editFile = createEditFile(fs);
      await expect(call(editFile, { file: '/a.ts', textEdits: [{ action: 'regex_text', pattern: 'foo', replacement: 'x' }] })).rejects.toThrow('matched 2 times');
    });
  });

  describe('combined edits', () => {
    it('applies lineEdits before textEdits', async () => {
      const fs = new MemoryFileSystem({ '/a.ts': 'oldCall()\nkeep' });
      const editFile = createEditFile(fs);
      await call(editFile, {
        file: '/a.ts',
        lineEdits: [{ action: 'insert', after_line: -1, content: 'function helper() {}' }],
        textEdits: [{ action: 'replace_text', oldString: 'oldCall()', replacement: 'helper()' }],
      });
      const actual = await fs.readFile('/a.ts');
      expect(actual).toBe('helper()\nkeep\nfunction helper() {}');
    });
  });

  describe('input validation', () => {
    it('throws when neither lineEdits nor textEdits is provided', async () => {
      const fs = new MemoryFileSystem({ '/a.ts': 'foo' });
      const editFile = createEditFile(fs);
      expect(() => editFile.input_schema.parse({ file: '/a.ts' })).toThrow('At least one edit must be provided');
    });
  });
});
