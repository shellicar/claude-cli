import { channel, type Ended } from '@shellicar/orchestrate-core';
import { describe, expect, it } from 'vitest';
import { createFindTool } from '../../src/Orchestrate/tools/Find.js';
import { MemoryFileSystem } from '../MemoryFileSystem.js';

// A source: nothing above it, so it has three of the four ports. It writes a path at a time, says
// what it could not do, and answers for how the walk went. What tells it to stop is its reader
// going away, which it learns from a write that was not accepted. There is no process here to take
// a signal, so an unaccepted write is the whole of it.

/** Counts the directories actually read, so a walk that stopped early is proven by absence. One
 *  named as unreadable throws when read, the way a directory without permission on it does. */
class CountingFileSystem extends MemoryFileSystem {
  public readdirCalls: string[] = [];
  public readonly unreadable = new Set<string>();
  public override async readdir(path: string) {
    this.readdirCalls.push(path);
    if (this.unreadable.has(path)) {
      const err = new Error(`EACCES: permission denied, scandir '${path}'`) as NodeJS.ErrnoException;
      err.code = 'EACCES';
      throw err;
    }
    return super.readdir(path);
  }
}

type Ran = {
  output: string;
  said: string[];
  ended: Ended;
  readdirCalls: string[];
};

type Given = {
  /** What is on disk. */
  files?: Record<string, string>;
  /** How far it may run ahead of whoever reads it. */
  ahead?: number;
  /** Whoever is reading walks away before the walk is finished. */
  readerLeaves?: boolean;
  /** Directories that cannot be read at all. */
  unreadable?: string[];
};

/** Walks once and reports everything observable about it. */
async function ran(input: Record<string, unknown>, given: Given = {}): Promise<Ran> {
  const fs = new CountingFileSystem(given.files ?? {});
  for (const path of given.unreadable ?? []) {
    fs.unreadable.add(path);
  }
  const tool = createFindTool(fs);
  const out = channel(given.ahead ?? 64 * 1024);
  const said: string[] = [];

  const running = tool.run(
    input,
    undefined,
    out,
    (line) => void said.push(line),
    () => {},
  );

  const chunks: Buffer[] = [];
  if (given.readerLeaves === true) {
    out.close();
  } else {
    for (let chunk = await out.read(); chunk != null; chunk = await out.read()) {
      chunks.push(chunk);
    }
  }
  await running.stop();
  return { output: Buffer.concat(chunks).toString('utf8'), said, ended: running.ended(), readdirCalls: fs.readdirCalls };
}

describe('what it writes', () => {
  it('writes a path at a time, one to a line', async () => {
    const { output } = await ran({ path: '/root' }, { files: { '/root/a.ts': 'x', '/root/b.ts': 'x' } });

    const expected = '/root/a.ts\n/root/b.ts\n';
    const actual = output;
    expect(actual).toBe(expected);
  });

  it('writes nothing at all when it found nothing', async () => {
    const { output } = await ran({ path: '/root', pattern: '\\.rs$' }, { files: { '/root/a.ts': 'x' } });

    const expected = '';
    const actual = output;
    expect(actual).toBe(expected);
  });

  // A path may contain a space, which is why the separator is the newline and nothing else. Whoever
  // reads this back splits on the same byte, and on that byte alone.
  it('writes a path with a space in it as one line', async () => {
    const { output } = await ran({ path: '/root' }, { files: { '/root/two words.ts': 'x' } });

    const expected = '/root/two words.ts\n';
    const actual = output;
    expect(actual).toBe(expected);
  });
});

describe('what it looks for', () => {
  it('finds only what matches the pattern it was given', async () => {
    const { output } = await ran({ path: '/root', pattern: '\\.ts$' }, { files: { '/root/a.ts': 'x', '/root/b.md': 'x' } });

    const expected = '/root/a.ts\n';
    const actual = output;
    expect(actual).toBe(expected);
  });

  it('finds directories when it was asked for directories', async () => {
    const { output } = await ran({ path: '/root', type: 'directory' }, { files: { '/root/src/a.ts': 'x' } });

    const expected = '/root/src\n';
    const actual = output;
    expect(actual).toBe(expected);
  });

  it('finds nothing under a directory it was told to leave out', async () => {
    const { output } = await ran({ path: '/root', exclude: ['skip'] }, { files: { '/root/a.ts': 'x', '/root/skip/b.ts': 'x' } });

    const expected = '/root/a.ts\n';
    const actual = output;
    expect(actual).toBe(expected);
  });

  it('finds nothing deeper than it was told to go', async () => {
    const { output } = await ran({ path: '/root', maxDepth: 1 }, { files: { '/root/a.ts': 'x', '/root/deep/b.ts': 'x' } });

    const expected = '/root/a.ts\n';
    const actual = output;
    expect(actual).toBe(expected);
  });
});

// The whole reason the walk is lazy. A reader that has gone stops the work, rather than the work
// finishing into a channel nobody is reading.
describe('a reader that goes away', () => {
  it('stops the walk where it stood, rather than reading the rest of the tree', async () => {
    const files = { '/root/dir1/a.ts': 'x', '/root/dir2/b.ts': 'x', '/root/dir3/c.ts': 'x' };

    const { readdirCalls } = await ran({ path: '/root' }, { files, readerLeaves: true });

    const expected = ['/root', '/root/dir1'];
    const actual = readdirCalls;
    expect(actual).toEqual(expected);
  });

  // Being told to stop is not the walk going wrong. A shell says the same thing: the producer of
  // `find | head` is killed, and nobody calls that a failed command.
  it('is not reported as a failure', async () => {
    const files = { '/root/dir1/a.ts': 'x', '/root/dir2/b.ts': 'x' };

    const { ended } = await ran({ path: '/root' }, { files, readerLeaves: true });

    const expected = { kind: 'finished' };
    const actual = ended;
    expect(actual).toEqual(expected);
  });
});

describe('how the walk went', () => {
  it('is finished when it reached the end of the tree', async () => {
    const { ended } = await ran({ path: '/root' }, { files: { '/root/a.ts': 'x' } });

    const expected = { kind: 'finished' };
    const actual = ended;
    expect(actual).toEqual(expected);
  });

  // `find` itself exits 1 when it could not read what it was pointed at.
  it('is a failure when the directory it was given cannot be read', async () => {
    const { ended } = await ran({ path: '/missing' });

    const expected = { kind: 'failed', code: 1 };
    const actual = ended;
    expect(actual).toEqual(expected);
  });

  it('says why when the directory it was given cannot be read', async () => {
    const { said } = await ran({ path: '/missing' });

    const expected = ["ENOENT: no such file or directory, scandir '/missing'"];
    const actual = said;
    expect(actual).toEqual(expected);
  });
});

// A directory that cannot be read leaves the answer incomplete, and an incomplete answer that says
// nothing is how a search for a file that does exist comes back empty and is believed.
describe('a directory it cannot enter', () => {
  it('still hands back everything it could reach', async () => {
    const files = { '/root/a.ts': 'x', '/root/locked/b.ts': 'x' };

    const { output } = await ran({ path: '/root' }, { files, unreadable: ['/root/locked'] });

    const expected = '/root/a.ts\n';
    const actual = output;
    expect(actual).toBe(expected);
  });

  // A count and not a list, because what a stage says is bounded and lines past the bound are
  // dropped where nobody sees them. A tree with three hundred unreadable directories would lose
  // both the names and the number; a count survives whole, and the number is the part that is
  // acted on.
  it('says how many it could not read', async () => {
    const files = { '/root/locked1/a.ts': 'x', '/root/locked2/b.ts': 'x' };

    const { said } = await ran({ path: '/root' }, { files, unreadable: ['/root/locked1', '/root/locked2'] });

    const expected = ['2 directories could not be read'];
    const actual = said;
    expect(actual).toEqual(expected);
  });

  it('says a single one as one directory', async () => {
    const files = { '/root/locked/a.ts': 'x' };

    const { said } = await ran({ path: '/root' }, { files, unreadable: ['/root/locked'] });

    const expected = ['1 directory could not be read'];
    const actual = said;
    expect(actual).toEqual(expected);
  });

  // The answer is qualified, not wrong. The walk did everything it was allowed to do, and calling
  // that a failure sends whoever reads the report looking for a defect that is not there, while
  // stopping anything joined to it by &&.
  it('is not a failure', async () => {
    const files = { '/root/locked/a.ts': 'x' };

    const { ended } = await ran({ path: '/root' }, { files, unreadable: ['/root/locked'] });

    const expected = { kind: 'finished' };
    const actual = ended;
    expect(actual).toEqual(expected);
  });

  it('says nothing at all when every directory could be read', async () => {
    const { said } = await ran({ path: '/root' }, { files: { '/root/a.ts': 'x' } });

    const expected: string[] = [];
    const actual = said;
    expect(actual).toEqual(expected);
  });
});
