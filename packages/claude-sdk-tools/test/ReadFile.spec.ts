import { describe, expect, it } from 'vitest';
import { MemoryFileSystem } from './MemoryFileSystem';
import { createReadFile } from '../src/ReadFile/ReadFile';
import { call } from './helpers';

const makeFs = () =>
  new MemoryFileSystem({
    '/src/hello.ts': 'const a = 1;\nconst b = 2;\nconst c = 3;',
    '/src/single.ts': 'single line',
  });

describe('createReadFile \u2014 success', () => {
  it('returns lines as content output', async () => {
    const ReadFile = createReadFile(makeFs());
    const result = await call(ReadFile, { path: '/src/hello.ts' });
    expect(result).toMatchObject({
      type: 'content',
      values: ['const a = 1;', 'const b = 2;', 'const c = 3;'],
      totalLines: 3,
      path: '/src/hello.ts',
    });
  });

  it('returns a single-element array for a single-line file', async () => {
    const ReadFile = createReadFile(makeFs());
    const result = await call(ReadFile, { path: '/src/single.ts' });
    expect(result).toMatchObject({ type: 'content', values: ['single line'], totalLines: 1 });
  });

  it('returns correct totalLines matching values length', async () => {
    const ReadFile = createReadFile(makeFs());
    const result = await call(ReadFile, { path: '/src/hello.ts' });
    const content = result as { values: string[]; totalLines: number };
    expect(content.totalLines).toBe(content.values.length);
  });

  it('echoes the resolved path in the output', async () => {
    const ReadFile = createReadFile(makeFs());
    const result = await call(ReadFile, { path: '/src/hello.ts' });
    expect((result as { path: string }).path).toBe('/src/hello.ts');
  });
});

describe('createReadFile \u2014 error handling', () => {
  it('returns an error object for a missing file', async () => {
    const ReadFile = createReadFile(makeFs());
    const result = await call(ReadFile, { path: '/src/missing.ts' });
    expect(result).toMatchObject({ error: true, message: 'File not found', path: '/src/missing.ts' });
  });
});

describe('createReadFile — size limit', () => {
  it('returns an error for files exceeding the size limit', async () => {
    const bigContent = 'x'.repeat(501_000);
    const fs = new MemoryFileSystem({ '/logs/huge.log': bigContent });
    const ReadFile = createReadFile(fs);
    const result = await call(ReadFile, { path: '/logs/huge.log' });
    expect(result).toMatchObject({
      error: true,
      message: expect.stringContaining('too large'),
      path: '/logs/huge.log',
    });
  });
});
