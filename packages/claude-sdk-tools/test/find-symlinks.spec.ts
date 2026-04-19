import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFind } from '../src/Find/Find';
import { NodeFileSystem } from '../src/fs/NodeFileSystem';
import { call } from './helpers';

let fixturePath: string;

beforeAll(async () => {
  fixturePath = join(tmpdir(), `find-symlinks-${Date.now()}`);
  await mkdir(fixturePath, { recursive: true });

  // A regular file and a symlink pointing to it
  await writeFile(join(fixturePath, 'real-file.txt'), 'real content');
  await symlink(join(fixturePath, 'real-file.txt'), join(fixturePath, 'file-link.txt'));

  // A real directory with a file, and a symlink to that directory
  await mkdir(join(fixturePath, 'real-dir'));
  await writeFile(join(fixturePath, 'real-dir', 'inner.txt'), 'inner content');
  await symlink(join(fixturePath, 'real-dir'), join(fixturePath, 'dir-link'));

  // Another directory and its symlink, for testing exclude by name
  await mkdir(join(fixturePath, 'other-dir'));
  await writeFile(join(fixturePath, 'other-dir', 'other.txt'), 'other content');
  await symlink(join(fixturePath, 'other-dir'), join(fixturePath, 'other-link'));

  // A circular symlink: points back to the fixture root
  await symlink(fixturePath, join(fixturePath, 'circle'));
});

afterAll(async () => {
  await rm(fixturePath, { recursive: true, force: true });
});

describe('createFind — symlinks', () => {
  it('discovers files that are symlinks', async () => {
    const Find = createFind(new NodeFileSystem());
    const actual = await call(Find, { path: fixturePath });
    const expected = join(fixturePath, 'file-link.txt');
    expect(actual.values).toContain(expected);
  });

  it('discovers files inside symlinked directories', async () => {
    const Find = createFind(new NodeFileSystem());
    const actual = await call(Find, { path: fixturePath });
    const expected = join(fixturePath, 'dir-link', 'inner.txt');
    expect(actual.values).toContain(expected);
  });

  it('does not loop infinitely on circular symlinks', async () => {
    const Find = createFind(new NodeFileSystem());
    const actual = await Promise.race([call(Find, { path: fixturePath }), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out after 5000ms')), 5000))]);
    const expected = 'files';
    expect(actual.type).toBe(expected);
  });

  it('symlinked files match pattern filters', async () => {
    const Find = createFind(new NodeFileSystem());
    const actual = await call(Find, { path: fixturePath, pattern: '\\.txt$' });
    const expected = join(fixturePath, 'file-link.txt');
    expect(actual.values).toContain(expected);
  });

  it('symlinked directories are found when type is directory', async () => {
    const Find = createFind(new NodeFileSystem());
    const actual = await call(Find, { path: fixturePath, type: 'directory' });
    const expected = join(fixturePath, 'dir-link');
    expect(actual.values).toContain(expected);
  });

  it('exclude list applies to symlinked directory names', async () => {
    const Find = createFind(new NodeFileSystem());
    const actual = await call(Find, { path: fixturePath, exclude: ['other-link'] });
    const values = (actual as { type: 'files'; values: string[] }).values;
    const expected = join(fixturePath, 'dir-link', 'inner.txt');
    expect(values).toContain(expected);
  });
});
