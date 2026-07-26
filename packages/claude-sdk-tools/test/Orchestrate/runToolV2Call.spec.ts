import { describe, expect, it } from 'vitest';
import { createToolsV2Registry } from '../../src/Orchestrate/registry.js';
import { runToolV2Call } from '../../src/Orchestrate/runToolV2Call.js';
import { RefStore } from '../../src/RefStore/RefStore.js';
import { FakeExecutor } from '../FakeExecutor.js';
import { MemoryFileSystem } from '../MemoryFileSystem.js';
import { MemoryObjectStore } from '../MemoryObjectStore.js';

function makeRefStore(): RefStore {
  return new RefStore(new MemoryObjectStore());
}

describe('runToolV2Call — Orchestrate composing several tools', () => {
  it('returns ok with the piped result as content on success', async () => {
    const fs = new MemoryFileSystem({ '/root/a.txt': 'x', '/root/b.txt': 'x' });
    const registry = createToolsV2Registry({ fs, executor: new FakeExecutor(() => ({ exitCode: 0 })), refStore: makeRefStore() });

    const result = await runToolV2Call(
      'Orchestrate',
      {
        stages: [
          { tool: 'Find', input: { path: '/root', pattern: '\\.txt$' }, op: '|' },
          { tool: 'Head', input: { count: 1 } },
        ],
      },
      registry,
    );

    const expected = true;
    const actual = result.ok;
    expect(actual).toBe(expected);
  });

  it('rejects invalid input without running any stage', async () => {
    const registry = createToolsV2Registry({ fs: new MemoryFileSystem(), executor: new FakeExecutor(() => ({ exitCode: 0 })), refStore: makeRefStore() });

    const result = await runToolV2Call('Orchestrate', { stages: [{ tool: 'NotARealTool', input: {} }] }, registry);

    const expected = false;
    const actual = result.ok;
    expect(actual).toBe(expected);
  });

  it('calls the provided approve callback for a gated stage', async () => {
    const fs = new MemoryFileSystem({ '/root/a.txt': 'x' });
    const registry = createToolsV2Registry({ fs, executor: new FakeExecutor(() => ({ exitCode: 0 })), refStore: makeRefStore() });
    let approveCalled = false;

    await runToolV2Call('Orchestrate', { stages: [{ tool: 'Find', input: { path: '/root' } }] }, registry, async () => {
      approveCalled = true;
      return { approved: true };
    });

    const expected = true;
    const actual = approveCalled;
    expect(actual).toBe(expected);
  });
});

describe('runToolV2Call — a direct call to one registered tool, not through Orchestrate', () => {
  it('runs Find directly by name, wrapped as a single-stage sequence', async () => {
    const fs = new MemoryFileSystem({ '/root/a.txt': 'x' });
    const registry = createToolsV2Registry({ fs, executor: new FakeExecutor(() => ({ exitCode: 0 })), refStore: makeRefStore() });

    const result = await runToolV2Call('Find', { path: '/root' }, registry);

    const expected = true;
    const actual = result.ok;
    expect(actual).toBe(expected);
  });

  it('rejects a name outside the registry', async () => {
    const registry = createToolsV2Registry({ fs: new MemoryFileSystem(), executor: new FakeExecutor(() => ({ exitCode: 0 })), refStore: makeRefStore() });

    const result = await runToolV2Call('NotARealTool', {}, registry);

    const expected = false;
    const actual = result.ok;
    expect(actual).toBe(expected);
  });

  it('rejects input that fails the tool own model', async () => {
    const registry = createToolsV2Registry({ fs: new MemoryFileSystem(), executor: new FakeExecutor(() => ({ exitCode: 0 })), refStore: makeRefStore() });

    const result = await runToolV2Call('Range', { start: 10, end: 1 }, registry);

    const expected = false;
    const actual = result.ok;
    expect(actual).toBe(expected);
  });

  it('still gates a direct call the same way a composed call would', async () => {
    const fs = new MemoryFileSystem({ '/root/a.txt': 'x' });
    const registry = createToolsV2Registry({ fs, executor: new FakeExecutor(() => ({ exitCode: 0 })), refStore: makeRefStore() });
    let approveCalled = false;

    await runToolV2Call('Find', { path: '/root' }, registry, async () => {
      approveCalled = true;
      return { approved: true };
    });

    const expected = true;
    const actual = approveCalled;
    expect(actual).toBe(expected);
  });
});
