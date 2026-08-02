import { lines, lines as toLines } from '@shellicar/orchestrate-core';
import { describe, expect, it } from 'vitest';
import { createEditFileToolV2 } from '../../src/Orchestrate/tools/EditFile.js';
import { MemoryFileSystem } from '../MemoryFileSystem.js';

async function drain(stream: AsyncIterable<unknown>): Promise<string[]> {
  const out: string[] = [];
  for await (const value of toLines(stream)) {
    out.push(String(value));
  }
  return out;
}

describe('EditFile tool', () => {
  it('is fs.write tier', () => {
    const tool = createEditFileToolV2(new MemoryFileSystem());

    const expected = 'fs.write';
    const actual = tool.operation;
    expect(actual).toBe(expected);
  });

  it('writes the edited content to disk', async () => {
    const fs = new MemoryFileSystem({ '/a.ts': 'one\ntwo\nthree' });
    const tool = createEditFileToolV2(fs);

    const { stdout } = tool.run({ file: '/a.ts', lineEdits: [{ action: 'replace', startLine: 2, endLine: 2, content: 'TWO' }], textEdits: [] }, undefined, []);
    await drain(stdout);

    const expected = 'one\nTWO\nthree';
    const actual = await fs.readFile('/a.ts');
    expect(actual).toBe(expected);
  });

  it('yields a line-numbered diff, one line at a time', async () => {
    const fs = new MemoryFileSystem({ '/a.ts': 'one\ntwo\nthree' });
    const tool = createEditFileToolV2(fs);

    const { stdout } = tool.run({ file: '/a.ts', lineEdits: [{ action: 'replace', startLine: 2, endLine: 2, content: 'TWO' }], textEdits: [] }, undefined, []);
    const actual = await drain(stdout);

    const expected = true;
    expect(actual.some((line) => line.includes('+2:TWO'))).toBe(expected);
  });

  it('applies a textEdits replace_text', async () => {
    const fs = new MemoryFileSystem({ '/a.ts': 'const x = 1;' });
    const tool = createEditFileToolV2(fs);

    const { stdout } = tool.run({ file: '/a.ts', lineEdits: [], textEdits: [{ action: 'replace_text', oldString: 'const x', replacement: 'let x', replaceMultiple: false }] }, undefined, []);
    await drain(stdout);

    const expected = 'let x = 1;';
    const actual = await fs.readFile('/a.ts');
    expect(actual).toBe(expected);
  });

  it('applies lineEdits before textEdits', async () => {
    const fs = new MemoryFileSystem({ '/a.ts': 'oldCall()\nkeep' });
    const tool = createEditFileToolV2(fs);

    const { stdout } = tool.run(
      {
        file: '/a.ts',
        lineEdits: [{ action: 'insert', after_line: -1, content: 'function helper() {}' }],
        textEdits: [{ action: 'replace_text', oldString: 'oldCall()', replacement: 'helper()', replaceMultiple: false }],
      },
      undefined,
      [],
    );
    await drain(stdout);

    const expected = 'helper()\nkeep\nfunction helper() {}';
    const actual = await fs.readFile('/a.ts');
    expect(actual).toBe(expected);
  });

  it('rejects the stream with the real error when a line edit is out of bounds, reusing V1\u2019s own validation', async () => {
    const fs = new MemoryFileSystem({ '/a.ts': 'one\ntwo' });
    const tool = createEditFileToolV2(fs);

    const { stdout } = tool.run({ file: '/a.ts', lineEdits: [{ action: 'delete', startLine: 5, endLine: 5 }], textEdits: [] }, undefined, []);

    await expect(drain(stdout)).rejects.toThrow('out of bounds');
  });

  it('rejects the stream when a replace_text string is not found', async () => {
    const fs = new MemoryFileSystem({ '/a.ts': 'foo' });
    const tool = createEditFileToolV2(fs);

    const { stdout } = tool.run({ file: '/a.ts', lineEdits: [], textEdits: [{ action: 'replace_text', oldString: 'missing', replacement: 'x', replaceMultiple: false }] }, undefined, []);

    await expect(drain(stdout)).rejects.toThrow('not found');
  });

  it('does not write to disk when an edit throws', async () => {
    const fs = new MemoryFileSystem({ '/a.ts': 'foo' });
    const tool = createEditFileToolV2(fs);

    const { stdout } = tool.run({ file: '/a.ts', lineEdits: [], textEdits: [{ action: 'replace_text', oldString: 'missing', replacement: 'x', replaceMultiple: false }] }, undefined, []);
    await drain(stdout).catch(() => {});

    const expected = 'foo';
    const actual = await fs.readFile('/a.ts');
    expect(actual).toBe(expected);
  });

  it('reports success when the edit applies cleanly', async () => {
    const fs = new MemoryFileSystem({ '/a.ts': 'one' });
    const tool = createEditFileToolV2(fs);

    const { stdout, success } = tool.run({ file: '/a.ts', lineEdits: [{ action: 'replace', startLine: 1, endLine: 1, content: 'ONE' }], textEdits: [] }, undefined, []);
    await drain(stdout);

    const expected = true;
    const actual = success();
    expect(actual).toBe(expected);
  });
});
