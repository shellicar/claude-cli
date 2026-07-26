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

  it('deletes a file named directly, not piped', async () => {
    const fs = new MemoryFileSystem({ '/a.txt': 'x' });
    const tool = createDeleteToolV2(fs);

    const { stdout, success } = tool.run({ files: ['/a.txt'] }, undefined, []);
    const out = await drain(stdout);

    expect(success()).toBe(true);
    expect(out).toEqual(['deleted: /a.txt']);
    expect(await fs.exists('/a.txt')).toBe(false);
  });

  it('deletes every file in a piped batch when no files field is given', async () => {
    const fs = new MemoryFileSystem({ '/a.txt': 'x', '/b.txt': 'x' });
    const tool = createDeleteToolV2(fs);

    async function* upstream(): Stream<string> {
      yield '/a.txt';
      yield '/b.txt';
    }

    const { stdout, success } = tool.run({}, upstream(), []);
    const out = await drain(stdout);

    expect(success()).toBe(true);
    expect(out.sort()).toEqual(['deleted: /a.txt', 'deleted: /b.txt']);
  });

  it('prefers files over a piped upstream when both are present', async () => {
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

  it('yields nothing and reports no failure when nothing is deleted at all', async () => {
    const tool = createDeleteToolV2(new MemoryFileSystem());

    const { stdout, success } = tool.run({}, undefined, []);
    const out = await drain(stdout);

    expect(out).toEqual([]);
    expect(success()).toBe(true);
  });
});
