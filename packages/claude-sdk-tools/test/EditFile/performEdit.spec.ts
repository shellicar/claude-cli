import { describe, expect, it } from 'vitest';
import { performEdit } from '../../src/EditFile/performEdit.js';
import { MemoryFileSystem } from '../MemoryFileSystem.js';

describe('performEdit', () => {
  it('writes the edited content to disk', async () => {
    const fs = new MemoryFileSystem({ '/a.ts': 'one\ntwo\nthree' });

    await performEdit(fs, '/a.ts', [{ action: 'replace', startLine: 2, endLine: 2, content: 'TWO' }], []);

    const expected = 'one\nTWO\nthree';
    const actual = await fs.readFile('/a.ts');
    expect(actual).toBe(expected);
  });

  it('returns a line-numbered diff', async () => {
    const fs = new MemoryFileSystem({ '/a.ts': 'one\ntwo\nthree' });

    const diff = await performEdit(fs, '/a.ts', [{ action: 'replace', startLine: 2, endLine: 2, content: 'TWO' }], []);

    const expected = true;
    const actual = diff.includes('+2:TWO');
    expect(actual).toBe(expected);
  });

  it('applies lineEdits before textEdits', async () => {
    const fs = new MemoryFileSystem({ '/a.ts': 'oldCall()\nkeep' });

    await performEdit(fs, '/a.ts', [{ action: 'insert', after_line: -1, content: 'function helper() {}' }], [{ action: 'replace_text', oldString: 'oldCall()', replacement: 'helper()', replaceMultiple: false }]);

    const expected = 'helper()\nkeep\nfunction helper() {}';
    const actual = await fs.readFile('/a.ts');
    expect(actual).toBe(expected);
  });

  it('throws when a line edit is out of bounds, and does not write to disk', async () => {
    const fs = new MemoryFileSystem({ '/a.ts': 'one\ntwo' });

    await expect(performEdit(fs, '/a.ts', [{ action: 'delete', startLine: 5, endLine: 5 }], [])).rejects.toThrow('out of bounds');

    const expected = 'one\ntwo';
    const actual = await fs.readFile('/a.ts');
    expect(actual).toBe(expected);
  });
});
