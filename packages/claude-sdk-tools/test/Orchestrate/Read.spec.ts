import { lines as toLines } from '@shellicar/orchestrate-core';
import { describe, expect, it } from 'vitest';
import { createReadToolV2 } from '../../src/Orchestrate/tools/Read.js';
import { MemoryFileSystem } from '../MemoryFileSystem.js';

describe('Read tool', () => {
  it('is fs.read tier \u2014 reading file content, not a directory listing', () => {
    const tool = createReadToolV2(new MemoryFileSystem());

    const expected = 'fs.read';
    const actual = tool.operation;
    expect(actual).toBe(expected);
  });

  it('emits each line prefixed with path:lineNumber:, the grep -Hn convention', async () => {
    const fs = new MemoryFileSystem({ '/a.txt': 'first\nsecond' });
    const tool = createReadToolV2(fs);

    const { stdout } = tool.run({ paths: ['/a.txt'] }, undefined, []);
    const out: string[] = [];
    for await (const line of toLines(stdout)) {
      out.push(line);
    }

    const expected = ['/a.txt:1:first', '/a.txt:2:second'];
    const actual = out;
    expect(actual).toEqual(expected);
  });

  it('reads content from multiple named files in order', async () => {
    const fs = new MemoryFileSystem({ '/a.txt': 'a-content', '/b.txt': 'b-content' });
    const tool = createReadToolV2(fs);

    const { stdout } = tool.run({ paths: ['/a.txt', '/b.txt'] }, undefined, []);
    const out: string[] = [];
    for await (const line of toLines(stdout)) {
      out.push(line);
    }

    const expected = ['/a.txt:1:a-content', '/b.txt:1:b-content'];
    const actual = out;
    expect(actual).toEqual(expected);
  });

  it('yields nothing and reports success when the path list is empty', async () => {
    const tool = createReadToolV2(new MemoryFileSystem());

    const { stdout, success } = tool.run({ paths: [] }, undefined, []);
    const out: string[] = [];
    for await (const line of toLines(stdout)) {
      out.push(line);
    }

    expect(out).toEqual([]);
    expect(success()).toBe(true);
  });

  it('reports failure when a named path does not exist', async () => {
    const fs = new MemoryFileSystem();
    const tool = createReadToolV2(fs);
    const stderr: string[] = [];

    const { stdout, success } = tool.run({ paths: ['/missing.txt'] }, undefined, stderr);
    for await (const _line of toLines(stdout)) {
      // drain
    }

    const expected = false;
    const actual = success();
    expect(actual).toBe(expected);
  });
});
