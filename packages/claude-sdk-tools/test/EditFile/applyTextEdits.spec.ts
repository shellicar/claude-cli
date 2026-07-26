import { describe, expect, it } from 'vitest';
import { applyTextEdits, sortBottomToTop } from '../../src/EditFile/applyTextEdits.js';

describe('sortBottomToTop', () => {
  it('sorts a replace edit after a later delete edit, so lines shift bottom-to-top', () => {
    const edits = [
      { action: 'delete' as const, startLine: 1, endLine: 1 },
      { action: 'replace' as const, startLine: 3, endLine: 3, content: 'x' },
    ];

    const expected = [3, 1];
    const actual = sortBottomToTop(4, edits).map((e) => (e.action === 'insert' ? -1 : e.startLine));
    expect(actual).toEqual(expected);
  });
});

describe('applyTextEdits \u2014 replace_text', () => {
  it('replaces a literal string', () => {
    const expected = 'let x = 1;';
    const actual = applyTextEdits('const x = 1;', [{ action: 'replace_text', oldString: 'const x', replacement: 'let x', replaceMultiple: false }]);
    expect(actual).toBe(expected);
  });

  it('throws when the string is not found', () => {
    expect(() => applyTextEdits('foo', [{ action: 'replace_text', oldString: 'missing', replacement: 'x', replaceMultiple: false }])).toThrow('not found');
  });

  it('throws when the string matches more than once without replaceMultiple', () => {
    expect(() => applyTextEdits('foo foo', [{ action: 'replace_text', oldString: 'foo', replacement: 'x', replaceMultiple: false }])).toThrow('matched 2 times');
  });

  it('replaces every match when replaceMultiple is true', () => {
    const expected = 'x x';
    const actual = applyTextEdits('foo foo', [{ action: 'replace_text', oldString: 'foo', replacement: 'x', replaceMultiple: true }]);
    expect(actual).toBe(expected);
  });
});

describe('applyTextEdits \u2014 regex_text', () => {
  it('replaces using a regex pattern', () => {
    const expected = 'import { Foo }';
    const actual = applyTextEdits('import type { Foo }', [{ action: 'regex_text', pattern: 'import type \\{ (\\w+) \\}', replacement: 'import { $1 }', replaceMultiple: false }]);
    expect(actual).toBe(expected);
  });

  it('throws when the pattern is not found', () => {
    expect(() => applyTextEdits('foo', [{ action: 'regex_text', pattern: 'missing', replacement: 'x', replaceMultiple: false }])).toThrow('not found');
  });
});
