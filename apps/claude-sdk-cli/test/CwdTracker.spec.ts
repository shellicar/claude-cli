import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { createServiceCollection } from '@shellicar/core-di-lite';
import { describe, expect, it } from 'vitest';
import { CwdTracker } from '../src/setup/CwdTracker.js';
import { MemoryFileSystem } from './MemoryFileSystem.js';

const noopLogger: ILogger = { trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

function make(cwd = '/repos/alpha') {
  // Seed a file under each directory the tests move into so MemoryFileSystem.chdir accepts the move.
  const fs = new MemoryFileSystem({ '/repos/alpha/a': 'x', '/repos/beta/b': 'y' }, '/home/user', cwd);
  const services = createServiceCollection();
  services.register(IFileSystem).to(IFileSystem, () => fs);
  services.register(ILogger).to(ILogger, () => noopLogger);
  services.register(CwdTracker).to(CwdTracker);
  const tracker = services.buildProvider().resolve(CwdTracker);
  return { tracker, fs };
}

describe('CwdTracker — first scan', () => {
  it('announces the current cwd', () => {
    const { tracker } = make();
    const actual = tracker.scanForDelta();
    expect(actual).toContain('/repos/alpha');
  });

  it('announces nothing on the next scan when the cwd has not moved', () => {
    const { tracker } = make();
    tracker.scanForDelta();
    const expected = null;
    const actual = tracker.scanForDelta();
    expect(actual).toBe(expected);
  });
});

describe('CwdTracker — move', () => {
  it('announces the destination', () => {
    const { tracker, fs } = make();
    tracker.scanForDelta();
    fs.chdir('/repos/beta');
    const actual = tracker.scanForDelta();
    expect(actual).toContain('/repos/beta');
  });

  it('states the origin the move came from', () => {
    const { tracker, fs } = make();
    tracker.scanForDelta();
    fs.chdir('/repos/beta');
    const actual = tracker.scanForDelta();
    expect(actual).toContain('/repos/alpha');
  });
});
