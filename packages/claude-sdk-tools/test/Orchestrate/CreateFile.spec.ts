import { lines as toLines } from '@shellicar/orchestrate-core';
import { describe, expect, it } from 'vitest';
import { createCreateFileToolV2 } from '../../src/Orchestrate/tools/CreateFile.js';
import { MemoryFileSystem } from '../MemoryFileSystem.js';

describe('CreateFile tool', () => {
  it('is fs.write tier', () => {
    const tool = createCreateFileToolV2(new MemoryFileSystem());

    const expected = 'fs.write';
    const actual = tool.operation;
    expect(actual).toBe(expected);
  });

  it('creates a new file with the given content', async () => {
    const fs = new MemoryFileSystem();
    const tool = createCreateFileToolV2(fs);

    const { success } = tool.run({ path: '/a.txt', content: 'hello' }, undefined, []);

    const expected = true;
    const actual = success();
    expect(actual).toBe(expected);
  });

  it('actually writes the content to the filesystem', async () => {
    const fs = new MemoryFileSystem();
    const tool = createCreateFileToolV2(fs);

    const { stdout } = tool.run({ path: '/a.txt', content: 'hello' }, undefined, []);
    for await (const _line of toLines(stdout)) {
      // drain
    }

    const expected = 'hello';
    const actual = await fs.readFile('/a.txt');
    expect(actual).toBe(expected);
  });

  it('defaults content to an empty string when omitted', async () => {
    const fs = new MemoryFileSystem();
    const tool = createCreateFileToolV2(fs);

    const { stdout } = tool.run({ path: '/a.txt' }, undefined, []);
    for await (const _line of toLines(stdout)) {
      // drain
    }

    const expected = '';
    const actual = await fs.readFile('/a.txt');
    expect(actual).toBe(expected);
  });

  it('fails when the file already exists and overwrite is not set', async () => {
    const fs = new MemoryFileSystem({ '/a.txt': 'existing' });
    const tool = createCreateFileToolV2(fs);
    const stderr: string[] = [];

    const { stdout, success } = tool.run({ path: '/a.txt' }, undefined, stderr);
    for await (const _line of toLines(stdout)) {
      // drain
    }

    const expected = false;
    const actual = success();
    expect(actual).toBe(expected);
  });

  it('names the reason in stderr when the file already exists', async () => {
    const fs = new MemoryFileSystem({ '/a.txt': 'existing' });
    const tool = createCreateFileToolV2(fs);
    const stderr: string[] = [];

    const { stdout } = tool.run({ path: '/a.txt' }, undefined, stderr);
    for await (const _line of toLines(stdout)) {
      // drain
    }

    const expected = ['File already exists. Set overwrite: true to replace it.'];
    const actual = stderr;
    expect(actual).toEqual(expected);
  });

  it('overwrites an existing file when overwrite is true', async () => {
    const fs = new MemoryFileSystem({ '/a.txt': 'old' });
    const tool = createCreateFileToolV2(fs);

    const { stdout } = tool.run({ path: '/a.txt', content: 'new', overwrite: true }, undefined, []);
    for await (const _line of toLines(stdout)) {
      // drain
    }

    const expected = 'new';
    const actual = await fs.readFile('/a.txt');
    expect(actual).toBe(expected);
  });

  it('fails when overwrite is true but the file does not exist', async () => {
    const fs = new MemoryFileSystem();
    const tool = createCreateFileToolV2(fs);
    const stderr: string[] = [];

    const { stdout, success } = tool.run({ path: '/missing.txt', overwrite: true }, undefined, stderr);
    for await (const _line of toLines(stdout)) {
      // drain
    }

    const expected = false;
    const actual = success();
    expect(actual).toBe(expected);
  });

  it('yields the created path on success', async () => {
    const fs = new MemoryFileSystem();
    const tool = createCreateFileToolV2(fs);

    const { stdout } = tool.run({ path: '/a.txt' }, undefined, []);
    const out: string[] = [];
    for await (const line of toLines(stdout)) {
      out.push(line);
    }

    const expected = ['created: /a.txt'];
    const actual = out;
    expect(actual).toEqual(expected);
  });
});
