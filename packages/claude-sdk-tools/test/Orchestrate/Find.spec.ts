import { describe, expect, it } from 'vitest';
import { createFindToolV2 } from '../../src/Orchestrate/tools/Find.js';
import { MemoryFileSystem } from '../MemoryFileSystem.js';

describe('Find tool', () => {
  it('is fs.list tier — a directory listing, not a file-content read', () => {
    const tool = createFindToolV2(new MemoryFileSystem());

    const expected = 'fs.list';
    const actual = tool.operation;
    expect(actual).toBe(expected);
  });

  it('yields matching paths as plain strings', async () => {
    const fs = new MemoryFileSystem({ '/root/a.txt': 'x', '/root/b.md': 'x' });
    const tool = createFindToolV2(fs);
    const stderr: string[] = [];

    const { stdout } = tool.run({ path: '/root', pattern: '\\.txt$' }, undefined, stderr);
    const paths: string[] = [];
    for await (const path of stdout) {
      paths.push(path);
    }

    const expected = ['/root/a.txt'];
    const actual = paths;
    expect(actual).toEqual(expected);
  });

  it('reports success once the walk completes without error', async () => {
    const fs = new MemoryFileSystem({ '/root/a.txt': 'x' });
    const tool = createFindToolV2(fs);
    const stderr: string[] = [];

    const { stdout, success } = tool.run({ path: '/root' }, undefined, stderr);
    for await (const _path of stdout) {
      // drain
    }

    const expected = true;
    const actual = success();
    expect(actual).toBe(expected);
  });

  it('reports failure when the start path does not exist', async () => {
    const fs = new MemoryFileSystem();
    const tool = createFindToolV2(fs);
    const stderr: string[] = [];

    const { stdout, success } = tool.run({ path: '/missing' }, undefined, stderr);
    for await (const _path of stdout) {
      // drain
    }

    const expected = false;
    const actual = success();
    expect(actual).toBe(expected);
  });

  it('records the error message on stderr when the start path does not exist', async () => {
    const fs = new MemoryFileSystem();
    const tool = createFindToolV2(fs);
    const stderr: string[] = [];

    const { stdout } = tool.run({ path: '/missing' }, undefined, stderr);
    for await (const _path of stdout) {
      // drain
    }

    const expected = 1;
    const actual = stderr.length;
    expect(actual).toBe(expected);
  });
});

describe('Find tool — summarize', () => {
  it('shows the path resolved relative to cwd, and the pattern when one is given', () => {
    const fs = new MemoryFileSystem({}, '/home/user', '/repo');
    const tool = createFindToolV2(fs);

    const expected = 'Find(src \\.ts$)';
    const actual = tool.summarize?.({ path: '/repo/src', pattern: '\\.ts$' });
    expect(actual).toBe(expected);
  });

  it('omits the pattern from the summary when none was given', () => {
    const fs = new MemoryFileSystem({}, '/home/user', '/repo');
    const tool = createFindToolV2(fs);

    const expected = 'Find(src)';
    const actual = tool.summarize?.({ path: '/repo/src' });
    expect(actual).toBe(expected);
  });
});
