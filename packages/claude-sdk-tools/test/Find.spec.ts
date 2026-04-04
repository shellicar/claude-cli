import { describe, expect, it } from 'vitest';
import { createFind } from '../src/Find/Find';
import { MemoryFileSystem } from '../src/fs/MemoryFileSystem';

const makeFs = () =>
  new MemoryFileSystem({
    '/src/index.ts': 'export const x = 1;',
    '/src/utils.ts': 'export function util() {}',
    '/src/components/Button.tsx': 'export const Button = () => null;',
    '/test/index.spec.ts': 'describe("suite", () => {});',
    '/README.md': '# Project',
  });

describe('createFind \u2014 file results', () => {
  it('returns all files under a directory', async () => {
    const Find = createFind(makeFs());
    const result = await Find.handler({ path: '/src' }, new Map());
    expect(result).toMatchObject({ type: 'files' });
    const { values } = result as { type: 'files'; values: string[] };
    expect(values).toContain('/src/index.ts');
    expect(values).toContain('/src/utils.ts');
    expect(values).toContain('/src/components/Button.tsx');
  });

  it('filters by glob pattern', async () => {
    const Find = createFind(makeFs());
    const result = await Find.handler({ path: '/src', pattern: '*.ts' }, new Map());
    const { values } = result as { type: 'files'; values: string[] };
    expect(values).toContain('/src/index.ts');
    expect(values).toContain('/src/utils.ts');
    expect(values).not.toContain('/src/components/Button.tsx');
  });

  it('respects maxDepth', async () => {
    const Find = createFind(makeFs());
    const result = await Find.handler({ path: '/src', maxDepth: 1 }, new Map());
    const { values } = result as { type: 'files'; values: string[] };
    expect(values).toContain('/src/index.ts');
    expect(values).toContain('/src/utils.ts');
    expect(values).not.toContain('/src/components/Button.tsx');
  });

  it('excludes specified directory names', async () => {
    const Find = createFind(makeFs());
    const result = await Find.handler({ path: '/src', exclude: ['components'] }, new Map());
    const { values } = result as { type: 'files'; values: string[] };
    expect(values).not.toContain('/src/components/Button.tsx');
    expect(values).toContain('/src/index.ts');
  });
});

describe('createFind \u2014 directory results', () => {
  it('returns directories when type is directory', async () => {
    const Find = createFind(makeFs());
    const result = await Find.handler({ path: '/src', type: 'directory' }, new Map());
    const { values } = result as { type: 'files'; values: string[] };
    expect(values).toContain('/src/components');
    expect(values).not.toContain('/src/index.ts');
  });

  it('returns both files and directories when type is both', async () => {
    const Find = createFind(makeFs());
    const result = await Find.handler({ path: '/src', type: 'both' }, new Map());
    const { values } = result as { type: 'files'; values: string[] };
    expect(values).toContain('/src/index.ts');
    expect(values).toContain('/src/components');
  });
});

describe('createFind \u2014 error handling', () => {
  it('returns an error object for a non-existent directory', async () => {
    const Find = createFind(makeFs());
    const result = await Find.handler({ path: '/nonexistent' }, new Map());
    expect(result).toMatchObject({
      error: true,
      message: 'Directory not found',
      path: '/nonexistent',
    });
  });
});
