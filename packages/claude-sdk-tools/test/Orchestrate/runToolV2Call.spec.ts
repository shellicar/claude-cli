import { Clock } from '@js-joda/core';
import { describe, expect, it } from 'vitest';
import { createToolsV2Registry } from '../../src/Orchestrate/registry.js';
import { runToolV2Call } from '../../src/Orchestrate/runToolV2Call.js';
import { RefStore } from '../../src/RefStore/RefStore.js';
import { FakeExecutor } from '../FakeExecutor.js';
import { fakeEnvProvider } from '../fakeEnvProvider.js';
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

// `seq 1 100000 | head -3` is a success in any shell. The producer is killed by SIGPIPE when its
// reader walks away, and the call is judged on what it was asked to do, not on that kill.
describe('runToolV2Call — a producer stopped by its consumer', () => {
  function registryWithSignallingProgram() {
    return createToolsV2Registry({
      fs: new MemoryFileSystem(),
      executor: new FakeExecutor(() => ({ stdout: 'one\ntwo\nthree\n', exitCode: null, signal: 'SIGPIPE' })),
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
  }

  it('does not report the call as failed', async () => {
    const result = await runToolV2Call(
      'Orchestrate',
      {
        stages: [
          { tool: 'Program', input: { program: 'seq', args: ['1', '100'], cwd: '/' }, op: '|' },
          { tool: 'Head', input: { count: 1 } },
        ],
      },
      registryWithSignallingProgram(),
    );

    const expected = true;
    const actual = result.ok;
    expect(actual).toBe(expected);
  });

  it('says the stage was stopped rather than that it failed', async () => {
    const result = await runToolV2Call(
      'Orchestrate',
      {
        stages: [
          { tool: 'Program', input: { program: 'seq', args: ['1', '100'], cwd: '/' }, op: '|' },
          { tool: 'Head', input: { count: 1 } },
        ],
      },
      registryWithSignallingProgram(),
    );

    const expected = true;
    const actual = result.ok === true && result.content.includes('Program: stopped (SIGPIPE)');
    expect(actual).toBe(expected);
  });
});

// A stage that never ran, or one stopped for outgrowing what could be held, carries its reason on
// its own report. The summary is where a reader sees it, so it prints for every outcome, not only
// for a refusal.
describe('runToolV2Call — the reason a stage did not run', () => {
  it('appears in the summary', async () => {
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

    const result = await runToolV2Call(
      'Orchestrate',
      {
        stages: [
          { tool: 'Find', input: { path: '/root' }, op: '&&' },
          { tool: 'Read', input: { paths: ['/root/a.txt'] } },
        ],
      },
      registry,
      async () => ({ approved: false, message: 'not allowed here' }),
    );

    const expected = true;
    const actual = result.ok === false && result.error.includes('not allowed here');
    expect(actual).toBe(expected);
  });
});

// An approval request is published so it can be answered, so whatever it carries is stored whether
// it is approved or refused. A variable's value therefore never goes into the arguments: they carry
// the reference as written, and the value reaches the command through the environment it runs
// under, which happens only once the call was approved.
describe('runToolV2Call — what an approval is shown versus what runs', () => {
  function registryWith(executor: FakeExecutor, vars: NodeJS.ProcessEnv) {
    return createToolsV2Registry({
      fs: new MemoryFileSystem(),
      executor,
      refStore: makeRefStore(),
      sips: passthroughSips,
      logger: noopLogger,
      memoryStore: new RecordingMemoryStore(),
      historyReader: new RecordingHistoryReader(),
      currentSessionId: () => 'session',
      clock: Clock.systemUTC(),
      skillDirs: [],
      ...fakeEscalatedRegistryDeps(),
      // After the shared fakes, which bring an env provider of their own.
      envProvider: fakeEnvProvider(vars),
    });
  }

  it('shows an ambient variable as written rather than its value', async () => {
    const seen: unknown[] = [];
    const registry = registryWith(new FakeExecutor(() => ({ exitCode: 0 })), { SOME_PATH: '/etc/ssl/cert.pem' });

    await runToolV2Call('Program', { program: 'echo', args: ['$SOME_PATH'], cwd: '/' }, registry, async (ctx) => {
      seen.push(ctx.input);
      return { approved: true };
    });

    const expected = ['$SOME_PATH'];
    const actual = (seen[0] as { args: string[] }).args;
    expect(actual).toEqual(expected);
  });

  it('runs the command with the value', async () => {
    const executor = new FakeExecutor(() => ({ exitCode: 0 }));
    const registry = registryWith(executor, { SOME_PATH: '/etc/ssl/cert.pem' });

    await runToolV2Call('Program', { program: 'echo', args: ['$SOME_PATH'], cwd: '/' }, registry, async () => ({ approved: true }));

    const expected = ['/etc/ssl/cert.pem'];
    const actual = executor.calls[0]?.args;
    expect(actual).toEqual(expected);
  });

  it('shows a captured value as written rather than its value', async () => {
    const seen: unknown[] = [];
    const registry = registryWith(new FakeExecutor(() => ({ stdout: 'secret-token\n', exitCode: 0 })), {});

    await runToolV2Call(
      'Orchestrate',
      {
        stages: [
          { tool: 'Program', input: { program: 'get-token', cwd: '/' }, captureAs: 'TOKEN', op: '&&' },
          { tool: 'Program', input: { program: 'curl', args: ['-H', 'Bearer $TOKEN'], cwd: '/' } },
        ],
      },
      registry,
      async (ctx) => {
        seen.push(ctx.input);
        return { approved: true };
      },
    );

    const expected = true;
    const actual = seen.every((input) => JSON.stringify(input).includes('secret-token') === false);
    expect(actual).toBe(expected);
  });

  it('runs the command with the captured value', async () => {
    const executor = new FakeExecutor((cmd) => (cmd.program === 'get-token' ? { stdout: 'secret-token\n', exitCode: 0 } : { exitCode: 0 }));
    const registry = registryWith(executor, {});

    await runToolV2Call(
      'Orchestrate',
      {
        stages: [
          { tool: 'Program', input: { program: 'get-token', cwd: '/' }, captureAs: 'TOKEN', op: '&&' },
          { tool: 'Program', input: { program: 'curl', args: ['-H', 'Bearer $TOKEN'], cwd: '/' } },
        ],
      },
      registry,
      async () => ({ approved: true }),
    );

    const expected = ['-H', 'Bearer secret-token'];
    const actual = executor.calls[1]?.args;
    expect(actual).toEqual(expected);
  });
});
