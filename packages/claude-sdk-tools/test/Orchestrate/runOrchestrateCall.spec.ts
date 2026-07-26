import { describe, expect, it } from 'vitest';
import { createToolsV2Registry } from '../../src/Orchestrate/registry.js';
import { runOrchestrateCall } from '../../src/Orchestrate/runOrchestrateCall.js';
import { FakeExecutor } from '../FakeExecutor.js';
import { MemoryFileSystem } from '../MemoryFileSystem.js';

describe('runOrchestrateCall', () => {
  it('returns ok with the piped result as content on success', async () => {
    const fs = new MemoryFileSystem({ '/root/a.txt': 'x', '/root/b.txt': 'x' });
    const registry = createToolsV2Registry({ fs, executor: new FakeExecutor(() => ({ exitCode: 0 })) });

    const result = await runOrchestrateCall(
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
    const registry = createToolsV2Registry({ fs: new MemoryFileSystem(), executor: new FakeExecutor(() => ({ exitCode: 0 })) });

    const result = await runOrchestrateCall({ stages: [{ tool: 'NotARealTool', input: {} }] }, registry);

    const expected = false;
    const actual = result.ok;
    expect(actual).toBe(expected);
  });

  it('reports a stage failure as a not-ok result', async () => {
    const fs = new MemoryFileSystem();
    const registry = createToolsV2Registry({ fs, executor: new FakeExecutor(() => ({ exitCode: 0 })) });

    const result = await runOrchestrateCall({ stages: [{ tool: 'Find', input: { path: '/does-not-exist' } }] }, registry);

    const expected = false;
    const actual = result.ok;
    expect(actual).toBe(expected);
  });

  it('calls the provided approve callback for a gated stage', async () => {
    const fs = new MemoryFileSystem({ '/root/a.txt': 'x' });
    const registry = createToolsV2Registry({ fs, executor: new FakeExecutor(() => ({ exitCode: 0 })) });
    let approveCalled = false;

    await runOrchestrateCall({ stages: [{ tool: 'Find', input: { path: '/root' } }] }, registry, async () => {
      approveCalled = true;
      return true;
    });

    const expected = true;
    const actual = approveCalled;
    expect(actual).toBe(expected);
  });
});
