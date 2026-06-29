import { describe, expect, it } from 'vitest';
import { createFind, FindModel } from '../src/Find/Find';
import { MemoryFileSystem } from './MemoryFileSystem';

const makeFs = () =>
  new MemoryFileSystem({
    '/src/index.ts': 'export const x = 1;',
    '/src/utils.ts': 'export function util() {}',
    '/src/components/Button.tsx': 'export const Button = () => null;',
    '/test/index.spec.ts': 'describe("suite", () => {});',
    '/README.md': '# Project',
  });

const run = (fs: MemoryFileSystem, input: Record<string, unknown>) => createFind(fs).run(FindModel.parse(input));
const paths = async (fs: MemoryFileSystem, input: Record<string, unknown>) => (await run(fs, input)).files.map((f) => f.path);

describe('createFind — file results', () => {
  it('returns all files under a directory', async () => {
    const expected = ['/src/index.ts', '/src/utils.ts', '/src/components/Button.tsx'];
    const actual = await paths(makeFs(), { path: '/src' });
    expect(actual).toEqual(expect.arrayContaining(expected));
  });

  it('emits records carrying a file size', async () => {
    const fs = new MemoryFileSystem({ '/src/a.ts': 'abc' });
    const expected = 3;
    const actual = (await run(fs, { path: '/src' })).files[0].size;
    expect(actual).toBe(expected);
  });

  it('filters by regex pattern', async () => {
    const expected = false;
    const actual = (await paths(makeFs(), { path: '/src', pattern: '.ts$' })).includes('/src/components/Button.tsx');
    expect(actual).toBe(expected);
  });

  it('respects maxDepth', async () => {
    const expected = false;
    const actual = (await paths(makeFs(), { path: '/src', maxDepth: 1 })).includes('/src/components/Button.tsx');
    expect(actual).toBe(expected);
  });

  it('excludes specified directory names', async () => {
    const expected = false;
    const actual = (await paths(makeFs(), { path: '/src', exclude: ['components'] })).includes('/src/components/Button.tsx');
    expect(actual).toBe(expected);
  });

  it('excludes .git by default', async () => {
    const fs = new MemoryFileSystem({ '/src/index.ts': 'export const x = 1;', '/.git/config': '[core]', '/.git/HEAD': 'ref: refs/heads/main' });
    const expected = ['/src/index.ts'];
    const actual = await paths(fs, { path: '/' });
    expect(actual).toEqual(expected);
  });
});

describe('createFind — directory results', () => {
  it('returns directories when type is directory', async () => {
    const expected = '/src/components';
    const actual = await paths(makeFs(), { path: '/src', type: 'directory' });
    expect(actual).toContain(expected);
  });

  it('marks a directory record with the dir type', async () => {
    const expected = 'dir';
    const actual = (await run(makeFs(), { path: '/src', type: 'directory' })).files[0].type;
    expect(actual).toBe(expected);
  });
});

describe('createFind — error handling', () => {
  it('throws on a non-existent directory', async () => {
    await expect(run(makeFs(), { path: '/nonexistent' })).rejects.toThrow();
  });

  it('throws on a glob pattern (invalid regex)', async () => {
    await expect(run(makeFs(), { path: '/src', pattern: '*.ts' })).rejects.toThrow(SyntaxError);
  });
});
