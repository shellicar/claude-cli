import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { createServiceCollection } from '@shellicar/core-di-lite';
import { describe, expect, it } from 'vitest';
import { WorkingDirectory } from '../src/model/WorkingDirectory.js';
import { MemoryFileSystem } from './MemoryFileSystem.js';

function make(cwd = '/repos/project/chdir') {
  const fs = new MemoryFileSystem({ '/repos/hello/file.txt': 'x', '/repos/project/afile': 'y' }, '/home/user', cwd);
  const services = createServiceCollection();
  services.register(IFileSystem).to(IFileSystem, () => fs);
  services.register(WorkingDirectory).to(WorkingDirectory);
  const workingDirectory = services.buildProvider().resolve(WorkingDirectory);
  return { workingDirectory, fs };
}

describe('WorkingDirectory — successful move', () => {
  it('reports success for an existing directory', () => {
    const { workingDirectory } = make();
    const expected = true;
    const actual = workingDirectory.change('/repos/hello').ok;
    expect(actual).toBe(expected);
  });

  it('moves the working directory to the target', () => {
    const { workingDirectory, fs } = make();
    const expected = '/repos/hello';
    workingDirectory.change('/repos/hello');
    const actual = fs.cwd();
    expect(actual).toBe(expected);
  });

  it('emits the change event with the new directory', () => {
    const { workingDirectory } = make();
    const expected = '/repos/hello';
    let actual: string | null = null;
    workingDirectory.on('change', (cwd) => {
      actual = cwd;
    });
    workingDirectory.change('/repos/hello');
    expect(actual).toBe(expected);
  });

  it('resolves relative .. segments against the current directory', () => {
    const { workingDirectory, fs } = make();
    const expected = '/repos/hello';
    workingDirectory.change('/repos/project/chdir/../../hello');
    const actual = fs.cwd();
    expect(actual).toBe(expected);
  });
});

describe('WorkingDirectory — failed move', () => {
  it('reports failure when the directory does not exist', () => {
    const { workingDirectory } = make();
    const expected = false;
    const actual = workingDirectory.change('/nowhere').ok;
    expect(actual).toBe(expected);
  });

  it('carries a no-such-directory message on ENOENT', () => {
    const { workingDirectory } = make();
    const expected = 'no such directory';
    const result = workingDirectory.change('/nowhere');
    const actual = result.ok ? null : result.message;
    expect(actual).toBe(expected);
  });

  it('carries a not-a-directory message when the target is a file', () => {
    const { workingDirectory } = make();
    const expected = 'not a directory';
    const result = workingDirectory.change('/repos/project/afile');
    const actual = result.ok ? null : result.message;
    expect(actual).toBe(expected);
  });

  it('leaves the working directory unchanged on failure', () => {
    const { workingDirectory, fs } = make();
    const expected = '/repos/project/chdir';
    workingDirectory.change('/nowhere');
    const actual = fs.cwd();
    expect(actual).toBe(expected);
  });

  it('does not emit the change event on failure', () => {
    const { workingDirectory } = make();
    const expected = 0;
    let count = 0;
    workingDirectory.on('change', () => {
      count += 1;
    });
    workingDirectory.change('/nowhere');
    const actual = count;
    expect(actual).toBe(expected);
  });
});

describe('WorkingDirectory — blank input', () => {
  it('reports failure for an empty target', () => {
    const { workingDirectory } = make();
    const expected = false;
    const actual = workingDirectory.change('').ok;
    expect(actual).toBe(expected);
  });

  it('carries a no-directory-entered message for an empty target', () => {
    const { workingDirectory } = make();
    const expected = 'no directory entered';
    const result = workingDirectory.change('');
    const actual = result.ok ? null : result.message;
    expect(actual).toBe(expected);
  });

  it('rejects a whitespace-only target', () => {
    const { workingDirectory } = make();
    const expected = false;
    const actual = workingDirectory.change('   ').ok;
    expect(actual).toBe(expected);
  });

  it('does not move for an empty target', () => {
    const { workingDirectory, fs } = make();
    const expected = '/repos/project/chdir';
    workingDirectory.change('');
    const actual = fs.cwd();
    expect(actual).toBe(expected);
  });
});
