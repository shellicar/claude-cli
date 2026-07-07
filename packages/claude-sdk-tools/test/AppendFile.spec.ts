import { describe, expect, it } from 'vitest';
import { createAppendFile } from '../src/AppendFile/AppendFile';
import { call } from './helpers';
import { MemoryFileSystem } from './MemoryFileSystem';

describe('createAppendFile — appending to existing files', () => {
  it('appends content verbatim at the end of an existing file', async () => {
    const fs = new MemoryFileSystem({ '/log.txt': 'first\n' });
    const AppendFile = createAppendFile(fs);
    const expected = 'first\nsecond\n';

    await call(AppendFile, { path: '/log.txt', content: 'second\n' });
    const actual = await fs.readFile('/log.txt');

    expect(actual).toBe(expected);
  });

  it('leaves existing contents unchanged when appending empty content', async () => {
    const fs = new MemoryFileSystem({ '/log.txt': 'existing' });
    const AppendFile = createAppendFile(fs);
    const expected = 'existing';

    await call(AppendFile, { path: '/log.txt', content: '' });
    const actual = await fs.readFile('/log.txt');

    expect(actual).toBe(expected);
  });
});

describe('createAppendFile — creating files that do not exist', () => {
  it('creates the file when it does not exist', async () => {
    const fs = new MemoryFileSystem();
    const AppendFile = createAppendFile(fs);
    const expected = 'hello';

    await call(AppendFile, { path: '/new.txt', content: 'hello' });
    const actual = await fs.readFile('/new.txt');

    expect(actual).toBe(expected);
  });

  it('creates missing parent directories', async () => {
    const fs = new MemoryFileSystem();
    const AppendFile = createAppendFile(fs);
    const expected = 'nested';

    await call(AppendFile, { path: '/a/b/c.txt', content: 'nested' });
    const actual = await fs.readFile('/a/b/c.txt');

    expect(actual).toBe(expected);
  });
});

describe('createAppendFile — result shape', () => {
  it('returns a success result carrying the expanded path', async () => {
    const fs = new MemoryFileSystem();
    const AppendFile = createAppendFile(fs);
    const expected = { error: false, path: '/new.txt' };

    const actual = await call(AppendFile, { path: '/new.txt', content: 'hello' });

    expect(actual).toEqual(expected);
  });
});
