import { describe, expect, it } from 'vitest';
import { MemoryFileSystem } from '../src/fs/MemoryFileSystem';
import { createSearchFiles } from '../src/SearchFiles/SearchFiles';
import { call } from './helpers';

const makeFs = () =>
  new MemoryFileSystem({
    '/src/a.ts': 'export const x = 1;\n// TODO: remove this\nexport const y = 2;',
    '/src/b.ts': 'import { x } from "./a";\nconst z = x + 1;',
    '/src/c.ts': 'no matches here',
  });

const files = (values: string[]) => ({ type: 'files' as const, values });

describe('createSearchFiles \u2014 basic matching', () => {
  it('returns lines matching the pattern', async () => {
    const SearchFiles = createSearchFiles(makeFs());
    const result = await call(SearchFiles, { pattern: 'export', content: files(['/src/a.ts', '/src/b.ts']) });
    expect(result).toMatchObject({ type: 'content' });
    const { values } = result as { values: string[] };
    expect(values.some((v) => v.includes('export const x'))).toBe(true);
    expect(values.some((v) => v.includes('export const y'))).toBe(true);
  });

  it('only includes files that have matches', async () => {
    const SearchFiles = createSearchFiles(makeFs());
    const result = await call(SearchFiles, { pattern: 'export', content: files(['/src/a.ts', '/src/c.ts']) });
    const { values } = result as { values: string[] };
    expect(values.filter((v) => v.startsWith('/src/c.ts'))).toHaveLength(0);
  });

  it('formats results as path:line:content', async () => {
    const SearchFiles = createSearchFiles(makeFs());
    const result = await call(SearchFiles, { pattern: 'TODO', content: files(['/src/a.ts']) });
    const { values } = result as { values: string[] };
    expect(values).toHaveLength(1);
    expect(values[0]).toBe('/src/a.ts:2:// TODO: remove this');
  });

  it('returns empty content when no matches', async () => {
    const SearchFiles = createSearchFiles(makeFs());
    const result = await call(SearchFiles, { pattern: 'NOMATCHWHATSOEVER', content: files(['/src/a.ts', '/src/b.ts']) });
    expect(result).toMatchObject({ type: 'content', values: [], totalLines: 0 });
  });

  it('returns empty content when content is null/undefined', async () => {
    const SearchFiles = createSearchFiles(makeFs());
    const result = await call(SearchFiles, { pattern: 'export' });
    expect(result).toMatchObject({ type: 'content', values: [], totalLines: 0 });
  });
});

describe('createSearchFiles \u2014 case insensitive', () => {
  it('matches case-insensitively when flag is set', async () => {
    const SearchFiles = createSearchFiles(makeFs());
    const result = await call(SearchFiles, { pattern: 'todo', caseInsensitive: true, content: files(['/src/a.ts']) });
    const { values } = result as { values: string[] };
    expect(values).toHaveLength(1);
    expect(values[0]).toContain('TODO');
  });

  it('does not match case-insensitively when flag is unset', async () => {
    const SearchFiles = createSearchFiles(makeFs());
    const result = await call(SearchFiles, { pattern: 'todo', content: files(['/src/a.ts']) });
    const { values } = result as { values: string[] };
    expect(values).toHaveLength(0);
  });
});

describe('createSearchFiles \u2014 context lines', () => {
  it('includes surrounding lines when context > 0', async () => {
    const SearchFiles = createSearchFiles(makeFs());
    const result = await call(SearchFiles, { pattern: 'TODO', context: 1, content: files(['/src/a.ts']) });
    const { values } = result as { values: string[] };
    expect(values.length).toBe(3);
    expect(values.some((v) => v.includes('export const x'))).toBe(true);
    expect(values.some((v) => v.includes('TODO'))).toBe(true);
    expect(values.some((v) => v.includes('export const y'))).toBe(true);
  });
});
