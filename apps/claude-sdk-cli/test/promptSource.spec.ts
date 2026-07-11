import { describe, expect, it } from 'vitest';
import { readIfPresent, wrapBlock } from '../src/promptSource.js';
import { MemoryFileSystem } from './MemoryFileSystem.js';

const HOME = '/home/user';
const CWD = '/project';

describe('wrapBlock', () => {
  it('frames content as a named block with header, blank line, then body', () => {
    const expected = '<system-md>\nContents of /project/SYSTEM.md:\n\nBody.\n</system-md>';
    const actual = wrapBlock('system-md', 'Contents of /project/SYSTEM.md:', 'Body.');

    expect(actual).toBe(expected);
  });

  it('uses the given tag for both the opening and closing tag', () => {
    const expected = '<claude-md>\nheader\n\nbody\n</claude-md>';
    const actual = wrapBlock('claude-md', 'header', 'body');

    expect(actual).toBe(expected);
  });
});

describe('readIfPresent', () => {
  it('returns the trimmed file content when present', async () => {
    const fs = new MemoryFileSystem({ [`${CWD}/SYSTEM.md`]: '  Trimmed.  ' }, HOME, CWD);

    const expected = 'Trimmed.';
    const actual = await readIfPresent(fs, `${CWD}/SYSTEM.md`);

    expect(actual).toBe(expected);
  });

  it('returns null when the file is absent', async () => {
    const fs = new MemoryFileSystem({}, HOME, CWD);

    const expected = null;
    const actual = await readIfPresent(fs, `${CWD}/SYSTEM.md`);

    expect(actual).toBe(expected);
  });

  it('returns null when the file is empty after trimming', async () => {
    const fs = new MemoryFileSystem({ [`${CWD}/SYSTEM.md`]: '   \n  ' }, HOME, CWD);

    const expected = null;
    const actual = await readIfPresent(fs, `${CWD}/SYSTEM.md`);

    expect(actual).toBe(expected);
  });
});
