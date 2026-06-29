import { describe, expect, it } from 'vitest';
import { createPaths } from '../src/Paths/Paths';
import { MemoryFileSystem } from './MemoryFileSystem';

describe('createPaths', () => {
  it('produces a file record per explicit path', async () => {
    const fs = new MemoryFileSystem({ '/a.ts': 'x', '/b.ts': 'yy' });
    const expected = ['/a.ts', '/b.ts'];
    const actual = (await createPaths(fs).run({ paths: ['/a.ts', '/b.ts'] })).files.map((f) => f.path);
    expect(actual).toEqual(expected);
  });

  it('records the file size from stat', async () => {
    const fs = new MemoryFileSystem({ '/a.ts': 'xyz' });
    const expected = 3;
    const actual = (await createPaths(fs).run({ paths: ['/a.ts'] })).files[0].size;
    expect(actual).toBe(expected);
  });

  it('throws a fatal on a path that does not exist', async () => {
    const fs = new MemoryFileSystem();
    await expect(createPaths(fs).run({ paths: ['/nope'] })).rejects.toThrow('Path not found');
  });
});
