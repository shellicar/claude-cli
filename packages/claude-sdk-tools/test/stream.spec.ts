import { describe, expect, it } from 'vitest';
import { flattenContent, flattenFiles, formatSize } from '../src/stream';

describe('formatSize', () => {
  it('renders bytes under 1K with a B suffix', () => {
    const expected = '340B';
    const actual = formatSize(340);
    expect(actual).toBe(expected);
  });

  it('renders kilobytes with a K suffix', () => {
    const expected = '8K';
    const actual = formatSize(8192);
    expect(actual).toBe(expected);
  });

  it('renders an empty string for an absent size (a directory)', () => {
    const expected = '';
    const actual = formatSize(undefined);
    expect(actual).toBe(expected);
  });
});

describe('flattenFiles', () => {
  it('renders a plain file with its size, tab-separated', () => {
    const expected = 'src/types.ts\t340B';
    const actual = flattenFiles({ kind: 'files', files: [{ path: 'src/types.ts', type: 'file', size: 340 }] });
    expect(actual).toBe(expected);
  });

  it('renders a directory with a trailing slash and no size', () => {
    const expected = 'src/components/';
    const actual = flattenFiles({ kind: 'files', files: [{ path: 'src/components', type: 'dir' }] });
    expect(actual).toBe(expected);
  });

  it('renders a symlink as name -> target', () => {
    const expected = 'src/legacy.ts -> src/v1/legacy.ts\t8K';
    const actual = flattenFiles({ kind: 'files', files: [{ path: 'src/legacy.ts', type: 'link', target: 'src/v1/legacy.ts', size: 8192 }] });
    expect(actual).toBe(expected);
  });
});

describe('flattenContent', () => {
  it('groups lines under the path header with n:text lines', () => {
    const expected = '/a.ts\n1:x\n2:y';
    const actual = flattenContent({ kind: 'content', files: [{ path: '/a.ts', type: 'file', lines: [{ n: 1, text: 'x' }, { n: 2, text: 'y' }] }] });
    expect(actual).toBe(expected);
  });

  it('separates files with a blank line', () => {
    const expected = '/a.ts\n1:x\n\n/b.ts\n1:y';
    const actual = flattenContent({
      kind: 'content',
      files: [
        { path: '/a.ts', type: 'file', lines: [{ n: 1, text: 'x' }] },
        { path: '/b.ts', type: 'file', lines: [{ n: 1, text: 'y' }] },
      ],
    });
    expect(actual).toBe(expected);
  });

  it('renders an empty content line as n: with nothing after', () => {
    const expected = '/a.ts\n1:';
    const actual = flattenContent({ kind: 'content', files: [{ path: '/a.ts', type: 'file', lines: [{ n: 1, text: '' }] }] });
    expect(actual).toBe(expected);
  });
});
