import { Clock } from '@js-joda/core';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { ApprovalCoordinator, ISdkMessagePublisher } from '@shellicar/claude-sdk';
import { createServiceCollection } from '@shellicar/core-di';
import { describe, expect, it } from 'vitest';
import { OrchestrateEngine } from '../../src/Orchestrate/OrchestrateEngine.js';
import { createToolsV2Registry } from '../../src/Orchestrate/registry.js';
import { PolicyStore } from '../../src/Policy/PolicyStore.js';
import { RefStore } from '../../src/RefStore/RefStore.js';
import { FakeExecutor } from '../FakeExecutor.js';
import { fakeEscalatedRegistryDeps } from '../fakeEscalatedRegistryDeps.js';
import { passthroughSips } from '../helpers.js';
import { MemoryFileSystem } from '../MemoryFileSystem.js';
import { MemoryObjectStore } from '../MemoryObjectStore.js';
import { RecordingHistoryReader } from '../RecordingHistoryReader.js';
import { RecordingMemoryStore } from '../RecordingMemoryStore.js';

class NoopLogger extends ILogger {
  public trace(): void {}
  public debug(): void {}
  public info(): void {}
  public warn(): void {}
  public error(): void {}
}

class NoopPublisher extends ISdkMessagePublisher {
  public send(): void {}
  public close(): void {}
  public async drain(): Promise<void> {}
}

class RecordingPublisher extends ISdkMessagePublisher {
  public readonly messages: Parameters<ISdkMessagePublisher['send']>[0][] = [];
  public send(msg: Parameters<ISdkMessagePublisher['send']>[0]): void {
    this.messages.push(msg);
  }
  public close(): void {}
  public async drain(): Promise<void> {}
}

function makeEngineWithApproval(rules: ConstructorParameters<typeof PolicyStore>[0] = [{ default: 'ask' }]) {
  const fs = new MemoryFileSystem({ '/root/a.txt': 'x' });
  const registry = createToolsV2Registry({
    fs,
    executor: new FakeExecutor(() => ({ exitCode: 0 })),
    refStore: new RefStore(new MemoryObjectStore()),
    sips: passthroughSips,
    logger: new NoopLogger(),
    memoryStore: new RecordingMemoryStore(),
    historyReader: new RecordingHistoryReader(),
    currentSessionId: () => 'session',
    clock: Clock.systemUTC(),
    skillDirs: [],
    ...fakeEscalatedRegistryDeps(),
  });
  const policyStore = new PolicyStore(rules, registry);
  const provider = createServiceCollection().buildProvider();
  const approval = new ApprovalCoordinator();
  const publisher = new RecordingPublisher();
  const engine = new OrchestrateEngine(registry, policyStore, new NoopLogger(), provider, approval, publisher, fs, Clock.systemUTC());
  return { engine, approval, publisher };
}

function makeEngine() {
  const fs = new MemoryFileSystem({ '/root/a.txt': 'x' });
  const registry = createToolsV2Registry({
    fs,
    executor: new FakeExecutor(() => ({ exitCode: 0 })),
    refStore: new RefStore(new MemoryObjectStore()),
    sips: passthroughSips,
    logger: new NoopLogger(),
    memoryStore: new RecordingMemoryStore(),
    historyReader: new RecordingHistoryReader(),
    currentSessionId: () => 'session',
    clock: Clock.systemUTC(),
    skillDirs: [],
    ...fakeEscalatedRegistryDeps(),
  });
  // No requestApproval is passed by these tests, so an 'ask' verdict auto-approves (matching
  // the existing "no human-ask configured" contract) — these tests are about owns()/outcome
  // mapping, not policy specifics.
  const policyStore = new PolicyStore([{ default: 'ask' }], registry);
  const provider = createServiceCollection().buildProvider();
  return new OrchestrateEngine(registry, policyStore, new NoopLogger(), provider, new ApprovalCoordinator(), new NoopPublisher(), fs, Clock.systemUTC());
}

describe('OrchestrateEngine.owns', () => {
  it('owns Orchestrate itself', () => {
    const engine = makeEngine();

    const expected = true;
    const actual = engine.owns('Orchestrate');
    expect(actual).toBe(expected);
  });

  it('owns every individually registered tool', () => {
    const engine = makeEngine();

    const expected = true;
    const actual = engine.owns('Find');
    expect(actual).toBe(expected);
  });

  it('does not own a name outside the registry', () => {
    const engine = makeEngine();

    const expected = false;
    const actual = engine.owns('DeleteFile');
    expect(actual).toBe(expected);
  });
});

describe('OrchestrateEngine.run', () => {
  it('maps a successful call onto an ok ToolOutcome', async () => {
    const engine = makeEngine();

    const outcome = await engine.run('Find', { path: '/root' });

    const expected = 'ok';
    const actual = outcome.kind;
    expect(actual).toBe(expected);
  });

  it('maps a failed call onto a failed ToolOutcome', async () => {
    const engine = makeEngine();

    const outcome = await engine.run('Find', { path: '/missing' });

    const expected = 'failed';
    const actual = outcome.kind;
    expect(actual).toBe(expected);
  });
});

describe('OrchestrateEngine.runBatch', () => {
  it("maps each item's outcome back onto its own id", async () => {
    const engine = makeEngine();

    const outcomes = await engine.runBatch([{ id: 'tu_1', name: 'Find', input: { path: '/root' } }], false);

    const expected = 'ok';
    const actual = outcomes.get('tu_1')?.kind;
    expect(actual).toBe(expected);
  });

  it('auto-approves without asking when requireApproval is false', async () => {
    const { engine, publisher } = makeEngineWithApproval();

    await engine.runBatch([{ id: 'tu_1', name: 'Find', input: { path: '/root' } }], false);

    const expected = 0;
    const actual = publisher.messages.filter((m) => m.type === 'tool_approval_request').length;
    expect(actual).toBe(expected);
  });

  it('sends a tool_approval_request naming the gated stage and its resolved input when requireApproval is true', async () => {
    const { engine, approval, publisher } = makeEngineWithApproval();

    const runPromise = engine.runBatch([{ id: 'tu_1', name: 'Find', input: { path: '/root' } }], true);
    await new Promise((resolve) => setImmediate(resolve));
    const request = publisher.messages.find((m) => m.type === 'tool_approval_request');
    if (request?.type !== 'tool_approval_request') {
      throw new Error('unreachable');
    }
    approval.handle({ type: 'tool_approval_response', requestId: request.requestId, approved: true });
    await runPromise;

    const expected = { name: 'Find', input: { path: '/root' } };
    const actual = { name: request.name, input: request.input };
    expect(actual).toEqual(expected);
  });

  it('keys the requestId as toolUseId:stageIndex', async () => {
    const { engine, approval, publisher } = makeEngineWithApproval();

    const runPromise = engine.runBatch([{ id: 'tu_1', name: 'Find', input: { path: '/root' } }], true);
    await new Promise((resolve) => setImmediate(resolve));
    const request = publisher.messages.find((m) => m.type === 'tool_approval_request');
    if (request?.type !== 'tool_approval_request') {
      throw new Error('unreachable');
    }
    approval.handle({ type: 'tool_approval_response', requestId: request.requestId, approved: true });
    await runPromise;

    const expected = 'tu_1:0';
    const actual = request.requestId;
    expect(actual).toBe(expected);
  });

  it('resolves to a failed outcome when the human approval is rejected', async () => {
    const { engine, approval, publisher } = makeEngineWithApproval();

    const runPromise = engine.runBatch([{ id: 'tu_1', name: 'Find', input: { path: '/root' } }], true);
    await new Promise((resolve) => setImmediate(resolve));
    const request = publisher.messages.find((m) => m.type === 'tool_approval_request');
    if (request?.type !== 'tool_approval_request') {
      throw new Error('unreachable');
    }
    approval.handle({ type: 'tool_approval_response', requestId: request.requestId, approved: false });
    const outcomes = await runPromise;

    const expected = 'failed';
    const actual = outcomes.get('tu_1')?.kind;
    expect(actual).toBe(expected);
  });

  it('never asks when the coordinator is already cancelled', async () => {
    const { engine, approval, publisher } = makeEngineWithApproval();
    approval.handle({ type: 'cancel' });

    await engine.runBatch([{ id: 'tu_1', name: 'Find', input: { path: '/root' } }], true);

    const expected = 0;
    const actual = publisher.messages.filter((m) => m.type === 'tool_approval_request').length;
    expect(actual).toBe(expected);
  });

  it('omits a stage position for a direct single-tool call', async () => {
    const { engine, approval, publisher } = makeEngineWithApproval();

    const runPromise = engine.runBatch([{ id: 'tu_1', name: 'Find', input: { path: '/root' } }], true);
    await new Promise((resolve) => setImmediate(resolve));
    const request = publisher.messages.find((m) => m.type === 'tool_approval_request');
    if (request?.type !== 'tool_approval_request') {
      throw new Error('unreachable');
    }
    approval.handle({ type: 'tool_approval_response', requestId: request.requestId, approved: true });
    await runPromise;

    const expected = { stageIndex: 1, stageCount: 1 };
    const actual = { stageIndex: request.stageIndex, stageCount: request.stageCount };
    expect(actual).toEqual(expected);
  });

  it('labels each gated stage of a multi-stage Orchestrate call with its position and the pipeline length', async () => {
    const { engine, approval, publisher } = makeEngineWithApproval();

    const runPromise = engine.runBatch(
      [
        {
          id: 'tu_1',
          name: 'Orchestrate',
          input: {
            stages: [
              { tool: 'Find', input: { path: '/root' }, op: '|' },
              { tool: 'Head', input: { count: 1 } },
            ],
          },
        },
      ],
      true,
    );
    await new Promise((resolve) => setImmediate(resolve));
    const request = publisher.messages.find((m) => m.type === 'tool_approval_request');
    if (request?.type !== 'tool_approval_request') {
      throw new Error('unreachable');
    }
    approval.handle({ type: 'tool_approval_response', requestId: request.requestId, approved: true });
    await runPromise;

    const expected = { stageIndex: 1, stageCount: 2 };
    const actual = { stageIndex: request.stageIndex, stageCount: request.stageCount };
    expect(actual).toEqual(expected);
  });

  // The label answers "where in this pipeline am I?" — so both numbers count the same thing:
  // every stage in the call, gated or not. Counting only the stages that happen to ask makes
  // the 3rd step of a 3-step pipeline read as "1 of 3" purely because the first two were
  // auto-allowed, which tells a human nothing about where the run actually is.
  it('labels a gated stage with its real position in the pipeline, not its position among the stages that happened to ask', async () => {
    const { engine, approval, publisher } = makeEngineWithApproval([{ operations: { 'fs.list': 'allow' }, default: 'ask' }]);

    const runPromise = engine.runBatch(
      [
        {
          id: 'tu_1',
          name: 'Orchestrate',
          input: {
            stages: [{ tool: 'Find', input: { path: '/root' }, op: '|' }, { xargs: 'files' }, { tool: 'Delete', input: {} }],
          },
        },
      ],
      true,
    );
    await new Promise((resolve) => setImmediate(resolve));
    const request = publisher.messages.find((m) => m.type === 'tool_approval_request');
    if (request?.type !== 'tool_approval_request') {
      throw new Error('unreachable');
    }
    approval.handle({ type: 'tool_approval_response', requestId: request.requestId, approved: true });
    await runPromise;

    const expected = { name: 'Delete', stageIndex: 3, stageCount: 3 };
    const actual = { name: request.name, stageIndex: request.stageIndex, stageCount: request.stageCount };
    expect(actual).toEqual(expected);
  });
});
