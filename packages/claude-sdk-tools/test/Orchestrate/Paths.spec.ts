import { lines as toLines } from '@shellicar/orchestrate-core';
import { describe, expect, it } from 'vitest';
import { createPathsToolV2 } from '../../src/Orchestrate/tools/Paths.js';
import { MemoryFileSystem } from '../MemoryFileSystem.js';

describe('Paths tool', () => {
  it('is fs.list tier \u2014 confirms existence, does not read file content', () => {
    const tool = createPathsToolV2(new MemoryFileSystem());

    const expected = 'fs.list';
    const actual = tool.operation;
    expect(actual).toBe(expected);
  });

  it('yields each explicit path that exists', async () => {
    const fs = new MemoryFileSystem({ '/a.txt': 'x', '/b.txt': 'x' });
    const tool = createPathsToolV2(fs);
    const stderr: string[] = [];

    const { stdout } = tool.run({ paths: ['/a.txt', '/b.txt'] }, undefined, stderr);
    const out: string[] = [];
    for await (const path of toLines(stdout)) {
      out.push(path);
    }

    const expected = ['/a.txt', '/b.txt'];
    const actual = out;
    expect(actual).toEqual(expected);
  });

  it('reports failure when a named path does not exist', async () => {
    const fs = new MemoryFileSystem();
    const tool = createPathsToolV2(fs);
    const stderr: string[] = [];

    const { stdout, success } = tool.run({ paths: ['/missing.txt'] }, undefined, stderr);
    for await (const _path of toLines(stdout)) {
      // drain
    }

    const expected = false;
    const actual = success();
    expect(actual).toBe(expected);
  });

  it('records the error message on stderr when a named path does not exist', async () => {
    const fs = new MemoryFileSystem();
    const tool = createPathsToolV2(fs);
    const stderr: string[] = [];

    const { stdout } = tool.run({ paths: ['/missing.txt'] }, undefined, stderr);
    for await (const _path of toLines(stdout)) {
      // drain
    }

    const expected = ['Path not found: /missing.txt'];
    const actual = stderr;
    expect(actual).toEqual(expected);
  });
});
