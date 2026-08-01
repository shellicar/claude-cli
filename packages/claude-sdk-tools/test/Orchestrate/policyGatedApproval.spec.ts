import { Clock } from '@js-joda/core';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { describe, expect, it } from 'vitest';
import { createPolicyGatedApproval } from '../../src/Orchestrate/policyGatedApproval.js';
import { createToolsV2Registry } from '../../src/Orchestrate/registry.js';
import { runToolV2Call } from '../../src/Orchestrate/runToolV2Call.js';
import { createFindToolV2 } from '../../src/Orchestrate/tools/Find.js';
import { PolicyStore } from '../../src/Policy/PolicyStore.js';
import { RefStore } from '../../src/RefStore/RefStore.js';
import { FakeExecutor } from '../FakeExecutor.js';
import { fakeEscalatedRegistryDeps } from '../fakeEscalatedRegistryDeps.js';
import { passthroughSips } from '../helpers.js';
import { MemoryFileSystem } from '../MemoryFileSystem.js';
import { MemoryObjectStore } from '../MemoryObjectStore.js';
import { RecordingHistoryReader } from '../RecordingHistoryReader.js';
import { RecordingMemoryStore } from '../RecordingMemoryStore.js';

function makeRefStore(): RefStore {
  return new RefStore(new MemoryObjectStore());
}

const lookup = { get: () => undefined };

class NoopLogger extends ILogger {
  public trace(_message: string, ..._meta: unknown[]): void {}
  public debug(_message: string, ..._meta: unknown[]): void {}
  public info(_message: string, ..._meta: unknown[]): void {}
  public warn(_message: string, ..._meta: unknown[]): void {}
  public error(_message: string, ..._meta: unknown[]): void {}
}

describe('createPolicyGatedApproval \u2014 an allow verdict', () => {
  it('approves the call', async () => {
    const policyStore = new PolicyStore([{ tool: 'Program', default: 'allow' }], lookup);
    const approve = createPolicyGatedApproval(
      policyStore,
      lookup,
      () => '/repo',
      () => 'linux',
      new NoopLogger(),
      async () => false,
    );

    const expected = true;
    const actual = (await approve({ name: 'Program', operations: ['fs.exec'], input: {}, asWritten: {}, batch: async () => [], stagePosition: 1, stageCount: 1 })).approved;
    expect(actual).toBe(expected);
  });

  it('never asks a human', async () => {
    const policyStore = new PolicyStore([{ tool: 'Program', default: 'allow' }], lookup);
    let humanAsked = false;
    const approve = createPolicyGatedApproval(
      policyStore,
      lookup,
      () => '/repo',
      () => 'linux',
      new NoopLogger(),
      async () => {
        humanAsked = true;
        return false;
      },
    );

    await approve({ name: 'Program', operations: ['fs.exec'], input: {}, asWritten: {}, batch: async () => [], stagePosition: 1, stageCount: 1 });

    const expected = false;
    const actual = humanAsked;
    expect(actual).toBe(expected);
  });
});

describe('createPolicyGatedApproval \u2014 a deny verdict', () => {
  it('denies the call', async () => {
    const policyStore = new PolicyStore([{ tool: 'Program', default: 'deny' }], lookup);
    const approve = createPolicyGatedApproval(
      policyStore,
      lookup,
      () => '/repo',
      () => 'linux',
      new NoopLogger(),
      async () => true,
    );

    const expected = false;
    const actual = (await approve({ name: 'Program', operations: ['fs.exec'], input: {}, asWritten: {}, batch: async () => [], stagePosition: 1, stageCount: 1 })).approved;
    expect(actual).toBe(expected);
  });

  it('never asks a human', async () => {
    const policyStore = new PolicyStore([{ tool: 'Program', default: 'deny' }], lookup);
    let humanAsked = false;
    const approve = createPolicyGatedApproval(
      policyStore,
      lookup,
      () => '/repo',
      () => 'linux',
      new NoopLogger(),
      async () => {
        humanAsked = true;
        return true;
      },
    );

    await approve({ name: 'Program', operations: ['fs.exec'], input: {}, asWritten: {}, batch: async () => [], stagePosition: 1, stageCount: 1 });

    const expected = false;
    const actual = humanAsked;
    expect(actual).toBe(expected);
  });

  it('carries the policy message through', async () => {
    const policyStore = new PolicyStore([{ tool: 'Program', default: 'deny', message: 'blocked by policy' }], lookup);
    const approve = createPolicyGatedApproval(
      policyStore,
      lookup,
      () => '/repo',
      () => 'linux',
      new NoopLogger(),
    );

    const outcome = await approve({ name: 'Program', operations: ['fs.exec'], input: {}, asWritten: {}, batch: async () => [], stagePosition: 1, stageCount: 1 });

    const expected = 'blocked by policy';
    const actual = !outcome.approved ? outcome.message : undefined;
    expect(actual).toBe(expected);
  });
});

describe('createPolicyGatedApproval \u2014 an ask verdict', () => {
  it('falls through to the human-ask callback', async () => {
    const policyStore = new PolicyStore([{ tool: 'Program', default: 'ask' }], lookup);
    const approve = createPolicyGatedApproval(
      policyStore,
      lookup,
      () => '/repo',
      () => 'linux',
      new NoopLogger(),
      async () => true,
    );

    const expected = true;
    const actual = (await approve({ name: 'Program', operations: ['fs.exec'], input: {}, asWritten: {}, batch: async () => [], stagePosition: 1, stageCount: 1 })).approved;
    expect(actual).toBe(expected);
  });

  it('auto-approves when no human-ask callback was supplied at all', async () => {
    const policyStore = new PolicyStore([{ tool: 'Program', default: 'ask' }], lookup);
    const approve = createPolicyGatedApproval(
      policyStore,
      lookup,
      () => '/repo',
      () => 'linux',
      new NoopLogger(),
    );

    const expected = true;
    const actual = (await approve({ name: 'Program', operations: ['fs.exec'], input: {}, asWritten: {}, batch: async () => [], stagePosition: 1, stageCount: 1 })).approved;
    expect(actual).toBe(expected);
  });
});

describe('createPolicyGatedApproval \u2014 logging', () => {
  it('logs every resolution under one grep-able message name', async () => {
    const policyStore = new PolicyStore([{ tool: 'Program', default: 'deny', message: 'blocked' }], lookup);
    const logs: unknown[] = [];
    const logger = new NoopLogger();
    logger.info = (message: string, ...meta: unknown[]) => {
      logs.push({ message, meta });
    };
    const approve = createPolicyGatedApproval(
      policyStore,
      lookup,
      () => '/repo',
      () => 'linux',
      logger,
    );

    await approve({ name: 'Program', operations: ['fs.exec'], input: {}, asWritten: {}, batch: async () => [], stagePosition: 1, stageCount: 1 });

    const expected = true;
    const actual = logs.some((l) => (l as { message: string }).message === 'policy_resolution');
    expect(actual).toBe(expected);
  });
});

describe('createPolicyGatedApproval \u2014 path extraction', () => {
  it('extracts the tool\u2019s own marked path field so a path-scoped rule can actually match', async () => {
    const findTool = createFindToolV2(new MemoryFileSystem());
    const registry = { get: (name: string) => (name === 'Find' ? findTool : undefined) };
    const policyStore = new PolicyStore([{ path: '/inside/**', default: 'deny' }], registry);
    const approve = createPolicyGatedApproval(
      policyStore,
      registry,
      () => '/repo',
      () => 'linux',
      new NoopLogger(),
    );

    const expected = false;
    const actual = (await approve({ name: 'Find', operations: ['fs.list'], input: { path: '/inside/dir' }, asWritten: { path: '/inside/dir' }, batch: async () => [], stagePosition: 1, stageCount: 1 })).approved;
    expect(actual).toBe(expected);
  });

  it('a path-scoped rule does not match when the tool\u2019s path is outside the rule\u2019s pattern', async () => {
    const findTool = createFindToolV2(new MemoryFileSystem());
    const registry = { get: (name: string) => (name === 'Find' ? findTool : undefined) };
    const policyStore = new PolicyStore(
      [
        { path: '/inside/**', default: 'deny' },
        { tool: '*', default: 'allow' },
      ],
      registry,
    );
    const approve = createPolicyGatedApproval(
      policyStore,
      registry,
      () => '/repo',
      () => 'linux',
      new NoopLogger(),
    );

    const expected = true;
    const actual = (await approve({ name: 'Find', operations: ['fs.list'], input: { path: '/outside/dir' }, asWritten: { path: '/outside/dir' }, batch: async () => [], stagePosition: 1, stageCount: 1 })).approved;
    expect(actual).toBe(expected);
  });

  it('a tool with no registered schema extracts no paths, so a real (non-wildcard) path-scoped rule cannot match it', async () => {
    const policyStore = new PolicyStore(
      [
        { path: '$PWD', default: 'deny' },
        { tool: '*', default: 'allow' },
      ],
      lookup,
    );
    const approve = createPolicyGatedApproval(
      policyStore,
      lookup,
      () => '/repo',
      () => 'linux',
      new NoopLogger(),
    );

    const expected = true;
    const actual = (await approve({ name: 'UnknownTool', operations: ['fs.exec'], input: { path: '/anything' }, asWritten: { path: '/anything' }, batch: async () => [], stagePosition: 1, stageCount: 1 })).approved;
    expect(actual).toBe(expected);
  });
});

describe('Program with no cwd \u2014 the default must come from the injected IFileSystem, never process.cwd() baked into the schema', () => {
  it('still runs, defaulting to the injected filesystem\u2019s own cwd \u2014 not rejected by the schema', async () => {
    const fs = new MemoryFileSystem({}, '/home/user', '/memory-cwd');
    const registry = createToolsV2Registry({
      fs,
      executor: new FakeExecutor(() => ({ exitCode: 0 })),
      refStore: makeRefStore(),
      sips: passthroughSips,
      logger: new NoopLogger(),
      memoryStore: new RecordingMemoryStore(),
      historyReader: new RecordingHistoryReader(),
      currentSessionId: () => 'session',
      clock: Clock.systemUTC(),
      skillDirs: [],
      ...fakeEscalatedRegistryDeps(),
    });
    // Allow everything: this test only proves the call actually reaches and runs Program at
    // all with a real, correct cwd \u2014 not that Policy denies it for an unrelated reason.
    const policyStore = new PolicyStore([{ tool: '*', default: 'allow' }], registry);
    const approve = createPolicyGatedApproval(
      policyStore,
      registry,
      () => fs.cwd(),
      () => 'linux',
      new NoopLogger(),
    );

    const expected = true;
    const actual = (await runToolV2Call('Program', { program: 'echo', args: ['hi'] }, registry, approve)).ok;
    expect(actual).toBe(expected);
  });

  it('the resolved cwd Policy sees for an omitted cwd is the injected filesystem\u2019s cwd, so a $PWD rule genuinely matches it', async () => {
    const fs = new MemoryFileSystem({}, '/home/user', '/memory-cwd');
    const registry = createToolsV2Registry({
      fs,
      executor: new FakeExecutor(() => ({ exitCode: 0 })),
      refStore: makeRefStore(),
      sips: passthroughSips,
      logger: new NoopLogger(),
      memoryStore: new RecordingMemoryStore(),
      historyReader: new RecordingHistoryReader(),
      currentSessionId: () => 'session',
      clock: Clock.systemUTC(),
      skillDirs: [],
      ...fakeEscalatedRegistryDeps(),
    });
    const policyStore = new PolicyStore(
      [
        { path: '$PWD', default: 'deny' },
        { tool: '*', default: 'allow' },
      ],
      registry,
    );
    const approve = createPolicyGatedApproval(
      policyStore,
      registry,
      () => fs.cwd(),
      () => 'linux',
      new NoopLogger(),
    );

    const expected = false;
    const actual = (await runToolV2Call('Program', { program: 'echo', args: ['hi'] }, registry, approve)).ok;
    expect(actual).toBe(expected);
  });

  it('is denied because the $PWD rule genuinely matched, not because the schema rejected the call before any stage ever ran', async () => {
    const fs = new MemoryFileSystem({}, '/home/user', '/memory-cwd');
    const registry = createToolsV2Registry({
      fs,
      executor: new FakeExecutor(() => ({ exitCode: 0 })),
      refStore: makeRefStore(),
      sips: passthroughSips,
      logger: new NoopLogger(),
      memoryStore: new RecordingMemoryStore(),
      historyReader: new RecordingHistoryReader(),
      currentSessionId: () => 'session',
      clock: Clock.systemUTC(),
      skillDirs: [],
      ...fakeEscalatedRegistryDeps(),
    });
    const policyStore = new PolicyStore(
      [
        { path: '$PWD', default: 'deny' },
        { tool: '*', default: 'allow' },
      ],
      registry,
    );
    const approve = createPolicyGatedApproval(
      policyStore,
      registry,
      () => fs.cwd(),
      () => 'linux',
      new NoopLogger(),
    );

    const result = await runToolV2Call('Program', { program: 'echo', args: ['hi'] }, registry, approve);

    // A schema rejection never produces "denied" text at all (it fails before any stage runs).
    const expected = 'denied';
    const actual = !result.ok ? result.error : '';
    expect(actual).toContain(expected);
  });
});

// A path written with a variable in it used to be judged as the characters it was typed with:
// `$HOME/.ssh/id_rsa` read as a relative path under the working directory, passed a rule scoped to
// $PWD, and was then expanded and opened. The decision and the action have to be about the same
// file.
describe('judging a path written with a variable in it', () => {
  function registryExpanding(fs: MemoryFileSystem) {
    return createToolsV2Registry({
      fs,
      executor: new FakeExecutor(() => ({ exitCode: 0 })),
      refStore: makeRefStore(),
      sips: passthroughSips,
      logger: new NoopLogger(),
      memoryStore: new RecordingMemoryStore(),
      historyReader: new RecordingHistoryReader(),
      currentSessionId: () => 'session',
      clock: Clock.systemUTC(),
      skillDirs: [],
      expand: (p) => p.replace('$HOME', '/home/user'),
      ...fakeEscalatedRegistryDeps(),
    });
  }

  const readsInsideTheProject = [
    { path: '$PWD', operations: { 'fs.read': 'allow' as const } },
    { path: '*', default: 'deny' as const },
  ];

  it('refuses a home path that a $PWD rule would have allowed as written', async () => {
    const fs = new MemoryFileSystem({ '/home/user/.ssh/id_rsa': 'secret' }, '/home/user', '/project');
    const registry = registryExpanding(fs);
    const approve = createPolicyGatedApproval(
      new PolicyStore(readsInsideTheProject, registry),
      registry,
      () => fs.cwd(),
      () => 'linux',
      new NoopLogger(),
    );

    const expected = false;
    const actual = (await runToolV2Call('Read', { paths: ['$HOME/.ssh/id_rsa'] }, registry, approve)).ok;
    expect(actual).toBe(expected);
  });

  it('still allows a path that really is inside the project', async () => {
    const fs = new MemoryFileSystem({ '/project/a.txt': 'hello' }, '/home/user', '/project');
    const registry = registryExpanding(fs);
    const approve = createPolicyGatedApproval(
      new PolicyStore(readsInsideTheProject, registry),
      registry,
      () => fs.cwd(),
      () => 'linux',
      new NoopLogger(),
    );

    const expected = true;
    const actual = (await runToolV2Call('Read', { paths: ['/project/a.txt'] }, registry, approve)).ok;
    expect(actual).toBe(expected);
  });
});

// A rule that matches on arguments is only worth anything if it sees the arguments the process
// will actually receive. A call can carry its own environment, and `Program` expands `$NAME` in its
// arguments from it, so a flag put there never appears in what Policy matched against.
describe('a rule matching on arguments, against a flag that arrives through a variable', () => {
  const noForcedRemoval = [
    { tool: 'Program', input: { program: { basename: ['rm'] }, args: { anyOf: ['-rf'] } }, default: 'deny' as const, message: 'no forced removal' },
    { tool: '*', default: 'allow' as const },
  ];

  function wiring() {
    const fs = new MemoryFileSystem({}, '/home/user', '/project');
    const executor = new FakeExecutor(() => ({ exitCode: 0 }));
    const registry = createToolsV2Registry({
      fs,
      executor,
      refStore: makeRefStore(),
      sips: passthroughSips,
      logger: new NoopLogger(),
      memoryStore: new RecordingMemoryStore(),
      historyReader: new RecordingHistoryReader(),
      currentSessionId: () => 'session',
      clock: Clock.systemUTC(),
      skillDirs: [],
      ...fakeEscalatedRegistryDeps(),
    });
    const approve = createPolicyGatedApproval(
      new PolicyStore(noForcedRemoval, registry),
      registry,
      () => fs.cwd(),
      () => 'linux',
      new NoopLogger(),
    );
    return { registry, approve, executor };
  }

  it('denies it, though the flag is not in the arguments as written', async () => {
    const { registry, approve } = wiring();

    const expected = false;
    const actual = (await runToolV2Call('Program', { program: 'rm', args: ['$MYARGS'], env: { MYARGS: '-rf' }, cwd: '/project' }, registry, approve)).ok;
    expect(actual).toBe(expected);
  });

  it('never runs it', async () => {
    const { registry, approve, executor } = wiring();

    await runToolV2Call('Program', { program: 'rm', args: ['$MYARGS'], env: { MYARGS: '-rf' }, cwd: '/project' }, registry, approve);

    const expected = 0;
    const actual = executor.calls.length;
    expect(actual).toBe(expected);
  });

  it('denies it when the flag arrives through a capture from an earlier stage', async () => {
    const fs = new MemoryFileSystem({}, '/home/user', '/project');
    const executor = new FakeExecutor((cmd) => (cmd.program === 'print-flag' ? { stdout: '-rf\n', exitCode: 0 } : { exitCode: 0 }));
    const registry = createToolsV2Registry({
      fs,
      executor,
      refStore: makeRefStore(),
      sips: passthroughSips,
      logger: new NoopLogger(),
      memoryStore: new RecordingMemoryStore(),
      historyReader: new RecordingHistoryReader(),
      currentSessionId: () => 'session',
      clock: Clock.systemUTC(),
      skillDirs: [],
      ...fakeEscalatedRegistryDeps(),
    });
    const approve = createPolicyGatedApproval(
      new PolicyStore(noForcedRemoval, registry),
      registry,
      () => fs.cwd(),
      () => 'linux',
      new NoopLogger(),
    );

    const result = await runToolV2Call(
      'Orchestrate',
      {
        stages: [
          { tool: 'Program', input: { program: 'print-flag', cwd: '/project' }, captureAs: 'FLAG', op: '&&' },
          { tool: 'Program', input: { program: 'rm', args: ['$FLAG'], cwd: '/project' } },
        ],
      },
      registry,
      approve,
    );

    const expected = false;
    const actual = result.ok;
    expect(actual).toBe(expected);
  });
});
