import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { describe, expect, it } from 'vitest';
import { createPolicyGatedApproval } from '../../src/Orchestrate/policyGatedApproval.js';
import { PolicyStore } from '../../src/Policy/PolicyStore.js';
import { createFindToolV2 } from '../../src/Orchestrate/tools/Find.js';
import { createToolsV2Registry } from '../../src/Orchestrate/registry.js';
import { runToolV2Call } from '../../src/Orchestrate/runToolV2Call.js';
import { FakeExecutor } from '../FakeExecutor.js';
import { MemoryFileSystem } from '../MemoryFileSystem.js';

const lookup = { get: () => undefined };

class NoopLogger extends ILogger {
  public trace(_message: string, ..._meta: unknown[]): void {}
  public debug(_message: string, ..._meta: unknown[]): void {}
  public info(_message: string, ..._meta: unknown[]): void {}
  public warn(_message: string, ..._meta: unknown[]): void {}
  public error(_message: string, ..._meta: unknown[]): void {}
}

describe('createPolicyGatedApproval', () => {
  it('approves without ever asking a human when the policy verdict is allow', async () => {
    const policyStore = new PolicyStore([{ tool: 'Program', default: 'allow' }], lookup);
    let humanAsked = false;
    const approve = createPolicyGatedApproval(policyStore, lookup, () => '/repo', new NoopLogger(), async () => {
      humanAsked = true;
      return false;
    });

    const outcome = await approve({ name: 'Program', operation: 'fs.exec', input: {}, batch: [] });

    expect(outcome.approved).toBe(true);
    expect(humanAsked).toBe(false);
  });

  it('denies without ever asking a human when the policy verdict is deny', async () => {
    const policyStore = new PolicyStore([{ tool: 'Program', default: 'deny' }], lookup);
    let humanAsked = false;
    const approve = createPolicyGatedApproval(policyStore, lookup, () => '/repo', new NoopLogger(), async () => {
      humanAsked = true;
      return true;
    });

    const outcome = await approve({ name: 'Program', operation: 'fs.exec', input: {}, batch: [] });

    expect(outcome.approved).toBe(false);
    expect(humanAsked).toBe(false);
  });

  it('falls through to the human-ask callback when the policy verdict is ask', async () => {
    const policyStore = new PolicyStore([{ tool: 'Program', default: 'ask' }], lookup);
    const approve = createPolicyGatedApproval(policyStore, lookup, () => '/repo', new NoopLogger(), async () => true);

    const outcome = await approve({ name: 'Program', operation: 'fs.exec', input: {}, batch: [] });

    expect(outcome.approved).toBe(true);
  });

  it('auto-approves an ask verdict when no human-ask callback was supplied at all', async () => {
    const policyStore = new PolicyStore([{ tool: 'Program', default: 'ask' }], lookup);
    const approve = createPolicyGatedApproval(policyStore, lookup, () => '/repo', new NoopLogger());

    const outcome = await approve({ name: 'Program', operation: 'fs.exec', input: {}, batch: [] });

    expect(outcome.approved).toBe(true);
  });

  it('carries the policy message through on a denial', async () => {
    const policyStore = new PolicyStore([{ tool: 'Program', default: 'deny', message: 'blocked by policy' }], lookup);
    const approve = createPolicyGatedApproval(policyStore, lookup, () => '/repo', new NoopLogger());

    const outcome = await approve({ name: 'Program', operation: 'fs.exec', input: {}, batch: [] });

    expect(outcome.approved).toBe(false);
    expect(!outcome.approved && outcome.message).toBe('blocked by policy');
  });

  it('logs every resolution under one grep-able message name', async () => {
    const policyStore = new PolicyStore([{ tool: 'Program', default: 'deny', message: 'blocked' }], lookup);
    const logs: unknown[] = [];
    const logger = new NoopLogger();
    logger.info = (message: string, ...meta: unknown[]) => {
      logs.push({ message, meta });
    };
    const approve = createPolicyGatedApproval(policyStore, lookup, () => '/repo', logger);

    await approve({ name: 'Program', operation: 'fs.exec', input: {}, batch: [] });

    const expected = true;
    const actual = logs.some((l) => (l as { message: string }).message === 'policy_resolution');
    expect(actual).toBe(expected);
  });
});

describe('createPolicyGatedApproval — path extraction', () => {
  it('extracts the tool\u2019s own marked path field so a path-scoped rule can actually match', async () => {
    const findTool = createFindToolV2(new MemoryFileSystem());
    const registry = { get: (name: string) => (name === 'Find' ? findTool : undefined) };
    const policyStore = new PolicyStore([{ path: '/inside/**', default: 'deny' }], registry);
    const approve = createPolicyGatedApproval(policyStore, registry, () => '/repo', new NoopLogger());

    const outcome = await approve({ name: 'Find', operation: 'fs.list', input: { path: '/inside/dir' }, batch: [] });

    expect(outcome.approved).toBe(false);
  });

  it('a path-scoped rule does not match when the tool\u2019s path is outside the rule\u2019s pattern', async () => {
    const findTool = createFindToolV2(new MemoryFileSystem());
    const registry = { get: (name: string) => (name === 'Find' ? findTool : undefined) };
    const policyStore = new PolicyStore([{ path: '/inside/**', default: 'deny' }, { tool: '*', default: 'allow' }], registry);
    const approve = createPolicyGatedApproval(policyStore, registry, () => '/repo', new NoopLogger());

    const outcome = await approve({ name: 'Find', operation: 'fs.list', input: { path: '/outside/dir' }, batch: [] });

    expect(outcome.approved).toBe(true);
  });

  it('a tool with no registered schema extracts no paths, so a real (non-wildcard) path-scoped rule cannot match it', async () => {
    const policyStore = new PolicyStore([{ path: '$PWD', default: 'deny' }, { tool: '*', default: 'allow' }], lookup);
    const approve = createPolicyGatedApproval(policyStore, lookup, () => '/repo', new NoopLogger());

    const outcome = await approve({ name: 'UnknownTool', operation: 'fs.exec', input: { path: '/anything' }, batch: [] });

    expect(outcome.approved).toBe(true);
  });
});

describe('Program with no cwd — the default must come from the injected IFileSystem, never process.cwd() baked into the schema', () => {
  it('a Program call omitting cwd entirely still runs, defaulting to the injected filesystem\u2019s own cwd — not rejected by the schema, not defaulted to the real process.cwd()', async () => {
    const fs = new MemoryFileSystem({}, '/home/user', '/memory-cwd');
    const registry = createToolsV2Registry({ fs, executor: new FakeExecutor(() => ({ exitCode: 0 })) });
    // Allow everything: this test only proves the call actually reaches and runs Program at
    // all with a real, correct cwd — not that Policy denies it for an unrelated reason.
    const policyStore = new PolicyStore([{ tool: '*', default: 'allow' }], registry);
    const approve = createPolicyGatedApproval(policyStore, registry, () => fs.cwd(), new NoopLogger());

    const result = await runToolV2Call('Program', { program: 'echo', args: ['hi'] }, registry, approve);

    expect(result.ok).toBe(true);
  });

  it('the resolved cwd Policy sees for an omitted cwd is the injected filesystem\u2019s cwd, so a $PWD rule genuinely matches it', async () => {
    const fs = new MemoryFileSystem({}, '/home/user', '/memory-cwd');
    const registry = createToolsV2Registry({ fs, executor: new FakeExecutor(() => ({ exitCode: 0 })) });
    const policyStore = new PolicyStore([{ path: '$PWD', default: 'deny' }, { tool: '*', default: 'allow' }], registry);
    const approve = createPolicyGatedApproval(policyStore, registry, () => fs.cwd(), new NoopLogger());

    const result = await runToolV2Call('Program', { program: 'echo', args: ['hi'] }, registry, approve);

    // Denied because the $PWD rule genuinely matched — not because the schema rejected the
    // call outright before any stage ever ran (a schema rejection never reaches "denied" text).
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain('denied');
  });
});
