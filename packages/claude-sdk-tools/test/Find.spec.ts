import { describe, expect, it } from 'vitest';
import { createFind } from '../src/Find/Find';
import { MemoryFileSystem } from '../src/fs/MemoryFileSystem';
import { call } from './helpers';

const makeFs = () =>
  new MemoryFileSystem({
    '/src/index.ts': 'export const x = 1;',
    '/src/utils.ts': 'export function util() {}',
    '/src/components/Button.tsx': 'export const Button = () => null;',
    '/test/index.spec.ts': 'describe("suite", () => {});',
    '/README.md': '# Project',
  });

describe('createFind u2014 file results', () => {
  it('returns all files under a directory', async () => {
    const Find = createFind(makeFs());
    const result = await call(Find, { path: '/src' });
    expect(result).toMatchObject({ type: 'files' });
    const { values } = result as { type: 'files'; values: string[] };
    expect(values).toContain('/src/index.ts');
    expect(values).toContain('/src/utils.ts');
    expect(values).toContain('/src/components/Button.tsx');
  });

  it('filters by glob pattern', async () => {
    const Find = createFind(makeFs());
    const result = await call(Find, { path: '/src', pattern: '*.ts' });
    const { values } = result as { type: 'files'; values: string[] };
    expect(values).toContain('/src/index.ts');
    expect(values).toContain('/src/utils.ts');
    expect(values).not.toContain('/src/components/Button.tsx');
  });

  it('respects maxDepth', async () => {
    const Find = createFind(makeFs());
    const result = await call(Find, { path: '/src', maxDepth: 1 });
    const { values } = result as { type: 'files'; values: string[] };
    expect(values).toContain('/src/index.ts');
    expect(values).toContain('/src/utils.ts');
    expect(values).not.toContain('/src/components/Button.tsx');
  });

  it('excludes specified directory names', async () => {
    const Find = createFind(makeFs());
    const result = await call(Find, { path: '/src', exclude: ['components'] });
    const { values } = result as { type: 'files'; values: string[] };
    expect(values).not.toContain('/src/components/Button.tsx');
    expect(values).toContain('/src/index.ts');
  });

  it('** glob pattern matches files in subdirectories', async () => {
    const Find = createFind(makeFs());
    const result = await call(Find, { path: '/', pattern: '**/*.ts' });
    const { values } = result as { type: 'files'; values: string[] };
    expect(values).toContain('/src/index.ts');
    expect(values).toContain('/src/utils.ts');
    expect(values).not.toContain('/src/components/Button.tsx');
  });
});

describe('createFind u2014 directory results', () => {
  it('returns directories when type is directory', async () => {
    const Find = createFind(makeFs());
    const result = await call(Find, { path: '/src', type: 'directory' });
    const { values } = result as { type: 'files'; values: string[] };
    expect(values).toContain('/src/components');
    expect(values).not.toContain('/src/index.ts');
  });

  it('returns both files and directories when type is both', async () => {
    const Find = createFind(makeFs());
    const result = await call(Find, { path: '/src', type: 'both' });
    const { values } = result as { type: 'files'; values: string[] };
    expect(values).toContain('/src/index.ts');
    expect(values).toContain('/src/components');
  });
});

describe('createFind u2014 error handling', () => {
  it('returns an error object for a non-existent directory', async () => {
    const Find = createFind(makeFs());
    const result = await call(Find, { path: '/nonexistent' });
    expect(result).toMatchObject({
      error: true,
      message: 'Directory not found',
      path: '/nonexistent',
    });
  });
});
