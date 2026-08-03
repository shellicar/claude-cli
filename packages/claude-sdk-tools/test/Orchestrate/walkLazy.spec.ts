import { describe, expect, it } from 'vitest';
import { walkLazy } from '../../src/Orchestrate/walkLazy.js';
import { MemoryFileSystem } from '../MemoryFileSystem.js';

describe('walkLazy — correctness', () => {
  it('yields only files matching the pattern', async () => {
    const fs = new MemoryFileSystem({ '/root/a.txt': 'x', '/root/b.md': 'x' });

    const paths: string[] = [];
    for await (const record of walkLazy(fs, '/root', { pattern: '\\.txt$' }, 1, /\.txt$/)) {
      paths.push(record.path);
    }

    const expected = ['/root/a.txt'];
    const actual = paths;
    expect(actual).toEqual(expected);
  });

  it('excludes directories named in the exclude list', async () => {
    const fs = new MemoryFileSystem({ '/root/keep/a.txt': 'x', '/root/node_modules/b.txt': 'x' });

    const paths: string[] = [];
    for await (const record of walkLazy(fs, '/root', { exclude: ['node_modules'] }, 1, undefined)) {
      paths.push(record.path);
    }

    const expected = ['/root/keep/a.txt'];
    const actual = paths;
    expect(actual).toEqual(expected);
  });

  it('respects maxDepth', async () => {
    const fs = new MemoryFileSystem({ '/root/shallow.txt': 'x', '/root/deep/nested.txt': 'x' });

    const paths: string[] = [];
    for await (const record of walkLazy(fs, '/root', { maxDepth: 1 }, 1, undefined)) {
      paths.push(record.path);
    }

    const expected = ['/root/shallow.txt'];
    const actual = paths;
    expect(actual).toEqual(expected);
  });
});

describe('walkLazy — laziness', () => {
  // Counts real fs calls, so a short-circuit can be proven by absence: if the walk actually
  // stops early, readdir is never called for a directory the caller never reached.
  class CountingFileSystem extends MemoryFileSystem {
    public readdirCalls: string[] = [];
    public override async readdir(path: string) {
      this.readdirCalls.push(path);
      return super.readdir(path);
    }
  }

  it('pulls at least one real item before stopping', async () => {
    const fs = new CountingFileSystem({ '/root/dir1/match.txt': 'x', '/root/dir2/match.txt': 'x' });
    const gen = walkLazy(fs, '/root', {}, 1, undefined);

    const first = await gen.next();
    await gen.return(undefined);

    const expected = false;
    const actual = first.done;
    expect(actual).toBe(expected);
  });

  it('does not descend into a later sibling directory once the caller stops pulling', async () => {
    const fs = new CountingFileSystem({
      '/root/dir1/match.txt': 'x',
      '/root/dir2/match.txt': 'x',
      '/root/dir3/match.txt': 'x',
    });

    const gen = walkLazy(fs, '/root', {}, 1, undefined);
    await gen.next();
    await gen.return(undefined);

    // /root itself, plus dir1 (where the one item taken came from) — never dir2 or dir3.
    const expected = ['/root', '/root/dir1'];
    const actual = fs.readdirCalls;
    expect(actual).toEqual(expected);
  });

  it('does read every directory when the caller drains the whole walk', async () => {
    const fs = new CountingFileSystem({
      '/root/dir1/a.txt': 'x',
      '/root/dir2/b.txt': 'x',
    });

    const paths: string[] = [];
    for await (const record of walkLazy(fs, '/root', {}, 1, undefined)) {
      paths.push(record.path);
    }

    const expected = ['/root', '/root/dir1', '/root/dir2'];
    const actual = fs.readdirCalls;
    expect(actual).toEqual(expected);
  });
});
