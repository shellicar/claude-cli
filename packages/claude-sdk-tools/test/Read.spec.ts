import { describe, expect, it } from 'vitest';
import { createRead } from '../src/Read/Read';
import { runStage } from './helpers';
import { MemoryFileSystem } from './MemoryFileSystem';

describe('createRead', () => {
  it('reads a file into grouped content with 1-based line numbers', async () => {
    const fs = new MemoryFileSystem({ '/a.ts': 'x\ny' });
    const expected = [
      { n: 1, text: 'x' },
      { n: 2, text: 'y' },
    ];
    const actual = (await runStage(createRead(fs), { input: { kind: 'files', files: [{ path: '/a.ts', type: 'file', size: 3 }] } })).files[0].lines;
    expect(actual).toEqual(expected);
  });

  it('carries the path on every content record', async () => {
    const fs = new MemoryFileSystem({ '/a.ts': 'x' });
    const expected = '/a.ts';
    const actual = (await runStage(createRead(fs), { input: { kind: 'files', files: [{ path: '/a.ts', type: 'file', size: 1 }] } })).files[0].path;
    expect(actual).toBe(expected);
  });

  it('skips a directory record (nothing to read)', async () => {
    const fs = new MemoryFileSystem({ '/a.ts': 'x' });
    const expected = 1;
    const actual = (
      await runStage(createRead(fs), {
        input: {
          kind: 'files',
          files: [
            { path: '/dir', type: 'dir' },
            { path: '/a.ts', type: 'file', size: 1 },
          ],
        },
      })
    ).files.length;
    expect(actual).toBe(expected);
  });

  it('skips a binary file (no text lines to contribute)', async () => {
    // A full PNG header (signature + IHDR) so file-type can sniff it; 8 bytes alone is too short.
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
    const fs = new MemoryFileSystem({ '/img.png': png, '/a.ts': 'x' });
    const expected = ['/a.ts'];
    const actual = (
      await runStage(createRead(fs), {
        input: {
          kind: 'files',
          files: [
            { path: '/img.png', type: 'file', size: png.byteLength },
            { path: '/a.ts', type: 'file', size: 1 },
          ],
        },
      })
    ).files.map((f) => f.path);
    expect(actual).toEqual(expected);
  });

  it('throws a fatal when a file cannot be read', async () => {
    const fs = new MemoryFileSystem();
    const actual = runStage(createRead(fs), { input: { kind: 'files', files: [{ path: '/gone.ts', type: 'file', size: 1 }] } });
    await expect(actual).rejects.toThrow('Cannot read');
  });
});
