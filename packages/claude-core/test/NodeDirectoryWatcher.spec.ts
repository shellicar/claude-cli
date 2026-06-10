import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeDirectoryWatcher } from '../src/Config/NodeDirectoryWatcher';

describe('NodeDirectoryWatcher', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cdw-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('fires onChange when a watched file is created after watching starts', async () => {
    const target = join(dir, 'sdk-config.json');
    const watcher = new NodeDirectoryWatcher();
    const seen: string[] = [];
    const handle = watcher.watch([target], (p) => seen.push(p));

    writeFileSync(target, '{}');
    await new Promise((r) => setTimeout(r, 150));
    handle.dispose();

    const expected = target;
    const actual = seen[0];
    expect(actual).toBe(expected);
  });

  it('ignores changes to sibling files in the same directory', async () => {
    const target = join(dir, 'sdk-config.json');
    const sibling = join(dir, 'other.json');
    const watcher = new NodeDirectoryWatcher();
    const seen: string[] = [];
    const handle = watcher.watch([target], (p) => seen.push(p));

    writeFileSync(sibling, '{}');
    await new Promise((r) => setTimeout(r, 150));
    handle.dispose();

    const expected = 0;
    const actual = seen.length;
    expect(actual).toBe(expected);
  });
});
