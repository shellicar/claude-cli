import { lines as toLines } from '@shellicar/orchestrate-core';
import { describe, expect, it } from 'vitest';
import { createAppendFileToolV2 } from '../../src/Orchestrate/tools/AppendFile.js';
import { MemoryFileSystem } from '../MemoryFileSystem.js';

describe('AppendFile tool', () => {
  it('is fs.write tier', () => {
    const tool = createAppendFileToolV2(new MemoryFileSystem());

    const expected = 'fs.write';
    const actual = tool.operation;
    expect(actual).toBe(expected);
  });

  it('creates the file when it does not exist yet', async () => {
    const fs = new MemoryFileSystem();
    const tool = createAppendFileToolV2(fs);

    const { stdout } = tool.run({ path: '/a.txt', content: 'first line\n' }, undefined, []);
    for await (const _line of toLines(stdout)) {
      // drain
    }

    const expected = 'first line\n';
    const actual = await fs.readFile('/a.txt');
    expect(actual).toBe(expected);
  });

  it('appends verbatim to the end of an existing file', async () => {
    const fs = new MemoryFileSystem({ '/a.txt': 'first line\n' });
    const tool = createAppendFileToolV2(fs);

    const { stdout } = tool.run({ path: '/a.txt', content: 'second line\n' }, undefined, []);
    for await (const _line of toLines(stdout)) {
      // drain
    }

    const expected = 'first line\nsecond line\n';
    const actual = await fs.readFile('/a.txt');
    expect(actual).toBe(expected);
  });

  it('reports success', async () => {
    const fs = new MemoryFileSystem();
    const tool = createAppendFileToolV2(fs);

    const { stdout, success } = tool.run({ path: '/a.txt', content: 'x' }, undefined, []);
    for await (const _line of toLines(stdout)) {
      // drain
    }

    const expected = true;
    const actual = success();
    expect(actual).toBe(expected);
  });

  it('yields the appended path', async () => {
    const fs = new MemoryFileSystem();
    const tool = createAppendFileToolV2(fs);

    const { stdout } = tool.run({ path: '/a.txt', content: 'x' }, undefined, []);
    const out: string[] = [];
    for await (const line of toLines(stdout)) {
      out.push(line);
    }

    const expected = ['appended: /a.txt'];
    const actual = out;
    expect(actual).toEqual(expected);
  });
});
