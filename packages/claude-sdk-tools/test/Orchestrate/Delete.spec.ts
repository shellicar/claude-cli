import type { Stream } from '@shellicar/orchestrate-core';
import { describe, expect, it } from 'vitest';
import { createDeleteToolV2 } from '../../src/Orchestrate/tools/Delete.js';
import { MemoryFileSystem } from '../MemoryFileSystem.js';

async function drain(stream: Stream<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const value of stream) {
    out.push(value);
  }
  return out;
}

describe('Delete tool', () => {
  it('is fs.delete tier', () => {
    const tool = createDeleteToolV2(new MemoryFileSystem());

    const expected = 'fs.delete';
    const actual = tool.operation;
    expect(actual).toBe(expected);
  });

  it('deletes every file named in files', async () => {
    const fs = new MemoryFileSystem({ '/a.txt': 'x', '/b.txt': 'x' });
    const tool = createDeleteToolV2(fs);

    const { stdout, success } = tool.run({ files: ['/a.txt', '/b.txt'] }, undefined, []);
    const out = await drain(stdout);

    expect(success()).toBe(true);
    expect(out.sort()).toEqual(['deleted: /a.txt', 'deleted: /b.txt']);
  });

  it('yields nothing and reports success when the file list is empty', async () => {
    const tool = createDeleteToolV2(new MemoryFileSystem());

    const { stdout, success } = tool.run({ files: [] }, undefined, []);
    const out = await drain(stdout);

    expect(out).toEqual([]);
    expect(success()).toBe(true);
  });

  it('ignores anything piped in \u2014 files must be fed via Xargs into its own field, never an implicit upstream read', async () => {
    const fs = new MemoryFileSystem({ '/direct.txt': 'x', '/piped.txt': 'x' });
    const tool = createDeleteToolV2(fs);

    async function* upstream(): Stream<string> {
      yield '/piped.txt';
    }

    const { stdout } = tool.run({ files: ['/direct.txt'] }, upstream(), []);
    await drain(stdout);

    expect(await fs.exists('/direct.txt')).toBe(false);
    expect(await fs.exists('/piped.txt')).toBe(true);
  });

  it('reports failure and a stderr message for a path that does not exist', async () => {
    const fs = new MemoryFileSystem();
    const tool = createDeleteToolV2(fs);
    const stderr: string[] = [];

    const { stdout, success } = tool.run({ files: ['/missing.txt'] }, undefined, stderr);
    await drain(stdout);

    expect(success()).toBe(false);
    expect(stderr).toEqual(['/missing.txt: Path not found']);
  });
});
