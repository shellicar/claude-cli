import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finished } from 'node:stream/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeFileSystem } from '../src/fs/NodeFileSystem';

describe('NodeFileSystem', () => {
  let dir: string;
  let fs: NodeFileSystem;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'node-file-system-'));
    fs = new NodeFileSystem();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('platform', () => {
    it('returns the real process platform', () => {
      const expected = process.platform;
      const actual = fs.platform();
      expect(actual).toBe(expected);
    });
  });

  describe('arch', () => {
    it('returns the real process arch', () => {
      const expected = process.arch;
      const actual = fs.arch();
      expect(actual).toBe(expected);
    });
  });

  describe('createWriteStream', () => {
    it('writes content to a new file with flags "w"', async () => {
      const path = join(dir, 'out.txt');
      const stream = fs.createWriteStream(path, { flags: 'w' });
      stream.end('hello');
      await finished(stream);

      const actual = readFileSync(path, 'utf-8');
      expect(actual).toBe('hello');
    });

    it('overwrites existing content with flags "w"', async () => {
      const path = join(dir, 'out.txt');
      const first = fs.createWriteStream(path, { flags: 'w' });
      first.end('first');
      await finished(first);

      const second = fs.createWriteStream(path, { flags: 'w' });
      second.end('second');
      await finished(second);

      const actual = readFileSync(path, 'utf-8');
      expect(actual).toBe('second');
    });

    it('appends content with flags "a"', async () => {
      const path = join(dir, 'out.txt');
      const first = fs.createWriteStream(path, { flags: 'w' });
      first.end('first-');
      await finished(first);

      const second = fs.createWriteStream(path, { flags: 'a' });
      second.end('second');
      await finished(second);

      const actual = readFileSync(path, 'utf-8');
      expect(actual).toBe('first-second');
    });
  });
});
