import { Clock } from '@js-joda/core';
import { describe, expect, it } from 'vitest';
import { createToolsV2Registry } from '../../src/Orchestrate/registry.js';
import { runToolV2Call } from '../../src/Orchestrate/runToolV2Call.js';
import { RefStore } from '../../src/RefStore/RefStore.js';
import { FakeExecutor } from '../FakeExecutor.js';
import { fakeEscalatedRegistryDeps } from '../fakeEscalatedRegistryDeps.js';
import { noopLogger, passthroughSips } from '../helpers.js';
import { MemoryFileSystem } from '../MemoryFileSystem.js';
import { MemoryObjectStore } from '../MemoryObjectStore.js';
import { RecordingHistoryReader } from '../RecordingHistoryReader.js';
import { RecordingMemoryStore } from '../RecordingMemoryStore.js';

function makeRefStore(): RefStore {
  return new RefStore(new MemoryObjectStore());
}

describe('runToolV2Call — Orchestrate composing several tools', () => {
  it('returns ok with the piped result as content on success', async () => {
    const fs = new MemoryFileSystem({ '/root/a.txt': 'x', '/root/b.txt': 'x' });
    const registry = createToolsV2Registry({
      fs,
      executor: new FakeExecutor(() => ({ exitCode: 0 })),
      refStore: makeRefStore(),
      sips: passthroughSips,
      logger: noopLogger,
      memoryStore: new RecordingMemoryStore(),
      historyReader: new RecordingHistoryReader(),
      currentSessionId: () => 'session',
      clock: Clock.systemUTC(),
      skillDirs: [],
      ...fakeEscalatedRegistryDeps(),
    });

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
    const registry = createToolsV2Registry({
      fs: new MemoryFileSystem(),
      executor: new FakeExecutor(() => ({ exitCode: 0 })),
      refStore: makeRefStore(),
      sips: passthroughSips,
      logger: noopLogger,
      memoryStore: new RecordingMemoryStore(),
      historyReader: new RecordingHistoryReader(),
      currentSessionId: () => 'session',
      clock: Clock.systemUTC(),
      skillDirs: [],
      ...fakeEscalatedRegistryDeps(),
    });

    const result = await runToolV2Call('Orchestrate', { stages: [{ tool: 'NotARealTool', input: {} }] }, registry);

    const expected = false;
    const actual = result.ok;
    expect(actual).toBe(expected);
  });

  it('calls the provided approve callback for a gated stage', async () => {
    const fs = new MemoryFileSystem({ '/root/a.txt': 'x' });
    const registry = createToolsV2Registry({
      fs,
      executor: new FakeExecutor(() => ({ exitCode: 0 })),
      refStore: makeRefStore(),
      sips: passthroughSips,
      logger: noopLogger,
      memoryStore: new RecordingMemoryStore(),
      historyReader: new RecordingHistoryReader(),
      currentSessionId: () => 'session',
      clock: Clock.systemUTC(),
      skillDirs: [],
      ...fakeEscalatedRegistryDeps(),
    });
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
    const registry = createToolsV2Registry({
      fs,
      executor: new FakeExecutor(() => ({ exitCode: 0 })),
      refStore: makeRefStore(),
      sips: passthroughSips,
      logger: noopLogger,
      memoryStore: new RecordingMemoryStore(),
      historyReader: new RecordingHistoryReader(),
      currentSessionId: () => 'session',
      clock: Clock.systemUTC(),
      skillDirs: [],
      ...fakeEscalatedRegistryDeps(),
    });

    const result = await runToolV2Call('Find', { path: '/root' }, registry);

    const expected = true;
    const actual = result.ok;
    expect(actual).toBe(expected);
  });

  it('rejects a name outside the registry', async () => {
    const registry = createToolsV2Registry({
      fs: new MemoryFileSystem(),
      executor: new FakeExecutor(() => ({ exitCode: 0 })),
      refStore: makeRefStore(),
      sips: passthroughSips,
      logger: noopLogger,
      memoryStore: new RecordingMemoryStore(),
      historyReader: new RecordingHistoryReader(),
      currentSessionId: () => 'session',
      clock: Clock.systemUTC(),
      skillDirs: [],
      ...fakeEscalatedRegistryDeps(),
    });

    const result = await runToolV2Call('NotARealTool', {}, registry);

    const expected = false;
    const actual = result.ok;
    expect(actual).toBe(expected);
  });

  it('rejects input that fails the tool own model', async () => {
    const registry = createToolsV2Registry({
      fs: new MemoryFileSystem(),
      executor: new FakeExecutor(() => ({ exitCode: 0 })),
      refStore: makeRefStore(),
      sips: passthroughSips,
      logger: noopLogger,
      memoryStore: new RecordingMemoryStore(),
      historyReader: new RecordingHistoryReader(),
      currentSessionId: () => 'session',
      clock: Clock.systemUTC(),
      skillDirs: [],
      ...fakeEscalatedRegistryDeps(),
    });

    const result = await runToolV2Call('Range', { start: 10, end: 1 }, registry);

    const expected = false;
    const actual = result.ok;
    expect(actual).toBe(expected);
  });

  it('still gates a direct call the same way a composed call would', async () => {
    const fs = new MemoryFileSystem({ '/root/a.txt': 'x' });
    const registry = createToolsV2Registry({
      fs,
      executor: new FakeExecutor(() => ({ exitCode: 0 })),
      refStore: makeRefStore(),
      sips: passthroughSips,
      logger: noopLogger,
      memoryStore: new RecordingMemoryStore(),
      historyReader: new RecordingHistoryReader(),
      currentSessionId: () => 'session',
      clock: Clock.systemUTC(),
      skillDirs: [],
      ...fakeEscalatedRegistryDeps(),
    });
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

// A `$NAME` reference resolves against what this run captured, and nothing else. Backing it with
// the environment instead would substitute any ambient variable into any string field of any tool
// — `$HOME` inside a file's content, for instance, which references nothing the run captured.
// Environment variables expand on a command line, in `Program`, against the env it spawns under.
describe('runToolV2Call — references resolve against captures, not the environment', () => {
  it('leaves an ambient environment variable untouched in a tool input', async () => {
    process.env.ORCHESTRATE_PROBE_VAR = 'leaked';
    try {
      const fs = new MemoryFileSystem();
      const registry = createToolsV2Registry({
        fs,
        executor: new FakeExecutor(() => ({ exitCode: 0 })),
        refStore: makeRefStore(),
        sips: passthroughSips,
        logger: noopLogger,
        memoryStore: new RecordingMemoryStore(),
        historyReader: new RecordingHistoryReader(),
        currentSessionId: () => 'session',
        clock: Clock.systemUTC(),
        skillDirs: [],
        ...fakeEscalatedRegistryDeps(),
      });

      await runToolV2Call('Orchestrate', { stages: [{ tool: 'CreateFile', input: { path: '/probe.txt', content: 'value: $ORCHESTRATE_PROBE_VAR' } }] }, registry);

      const expected = 'value: $ORCHESTRATE_PROBE_VAR';
      const actual = await fs.readFile('/probe.txt');
      expect(actual).toBe(expected);
    } finally {
      delete process.env.ORCHESTRATE_PROBE_VAR;
    }
  });
});
