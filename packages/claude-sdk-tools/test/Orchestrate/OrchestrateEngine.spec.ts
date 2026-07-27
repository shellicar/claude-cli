import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { describe, expect, it } from 'vitest';
import { OrchestrateEngine } from '../../src/Orchestrate/OrchestrateEngine.js';
import { createToolsV2Registry } from '../../src/Orchestrate/registry.js';
import { PolicyStore } from '../../src/Policy/PolicyStore.js';
import { RefStore } from '../../src/RefStore/RefStore.js';
import { FakeExecutor } from '../FakeExecutor.js';
import { passthroughSips } from '../helpers.js';
import { MemoryFileSystem } from '../MemoryFileSystem.js';
import { MemoryObjectStore } from '../MemoryObjectStore.js';

class NoopLogger extends ILogger {
  public trace(): void {}
  public debug(): void {}
  public info(): void {}
  public warn(): void {}
  public error(): void {}
}

function makeEngine() {
  const registry = createToolsV2Registry({ fs: new MemoryFileSystem({ '/root/a.txt': 'x' }), executor: new FakeExecutor(() => ({ exitCode: 0 })), refStore: new RefStore(new MemoryObjectStore()), sips: passthroughSips, logger: new NoopLogger() });
  // No requestApproval is passed by these tests, so an 'ask' verdict auto-approves (matching
  // the existing "no human-ask configured" contract) — these tests are about owns()/outcome
  // mapping, not policy specifics.
  const policyStore = new PolicyStore([{ default: 'ask' }], registry);
  return new OrchestrateEngine(registry, policyStore, new NoopLogger());
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
