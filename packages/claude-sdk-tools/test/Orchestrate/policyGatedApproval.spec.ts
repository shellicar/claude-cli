import { describe, expect, it } from 'vitest';
import { createPolicyGatedApproval } from '../../src/Orchestrate/policyGatedApproval.js';
import { PolicyStore } from '../../src/Policy/PolicyStore.js';
import { createFindToolV2 } from '../../src/Orchestrate/tools/Find.js';
import { MemoryFileSystem } from '../MemoryFileSystem.js';

const lookup = { get: () => undefined };

describe('createPolicyGatedApproval', () => {
  it('approves without ever asking a human when the policy verdict is allow', async () => {
    const policyStore = new PolicyStore([{ tool: 'Program', default: 'allow' }], lookup);
    let humanAsked = false;
    const approve = createPolicyGatedApproval(policyStore, lookup, () => '/repo', async () => {
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
    const approve = createPolicyGatedApproval(policyStore, lookup, () => '/repo', async () => {
      humanAsked = true;
      return true;
    });

    const outcome = await approve({ name: 'Program', operation: 'fs.exec', input: {}, batch: [] });

    expect(outcome.approved).toBe(false);
    expect(humanAsked).toBe(false);
  });

  it('falls through to the human-ask callback when the policy verdict is ask', async () => {
    const policyStore = new PolicyStore([{ tool: 'Program', default: 'ask' }], lookup);
    const approve = createPolicyGatedApproval(policyStore, lookup, () => '/repo', async () => true);

    const outcome = await approve({ name: 'Program', operation: 'fs.exec', input: {}, batch: [] });

    expect(outcome.approved).toBe(true);
  });

  it('auto-approves an ask verdict when no human-ask callback was supplied at all', async () => {
    const policyStore = new PolicyStore([{ tool: 'Program', default: 'ask' }], lookup);
    const approve = createPolicyGatedApproval(policyStore, lookup, () => '/repo');

    const outcome = await approve({ name: 'Program', operation: 'fs.exec', input: {}, batch: [] });

    expect(outcome.approved).toBe(true);
  });

  it('carries the policy message through on a denial', async () => {
    const policyStore = new PolicyStore([{ tool: 'Program', default: 'deny', message: 'blocked by policy' }], lookup);
    const approve = createPolicyGatedApproval(policyStore, lookup, () => '/repo');

    const outcome = await approve({ name: 'Program', operation: 'fs.exec', input: {}, batch: [] });

    expect(outcome.approved).toBe(false);
    expect(!outcome.approved && outcome.message).toBe('blocked by policy');
  });
});

describe('createPolicyGatedApproval — path extraction', () => {
  it('extracts the tool\u2019s own marked path field so a path-scoped rule can actually match', async () => {
    const findTool = createFindToolV2(new MemoryFileSystem());
    const registry = { get: (name: string) => (name === 'Find' ? findTool : undefined) };
    const policyStore = new PolicyStore([{ path: '/inside/**', default: 'deny' }], registry);
    const approve = createPolicyGatedApproval(policyStore, registry, () => '/repo');

    const outcome = await approve({ name: 'Find', operation: 'fs.list', input: { path: '/inside/dir' }, batch: [] });

    expect(outcome.approved).toBe(false);
  });

  it('a path-scoped rule does not match when the tool\u2019s path is outside the rule\u2019s pattern', async () => {
    const findTool = createFindToolV2(new MemoryFileSystem());
    const registry = { get: (name: string) => (name === 'Find' ? findTool : undefined) };
    const policyStore = new PolicyStore([{ path: '/inside/**', default: 'deny' }, { tool: '*', default: 'allow' }], registry);
    const approve = createPolicyGatedApproval(policyStore, registry, () => '/repo');

    const outcome = await approve({ name: 'Find', operation: 'fs.list', input: { path: '/outside/dir' }, batch: [] });

    expect(outcome.approved).toBe(true);
  });

  it('a tool with no registered schema extracts no paths, so a real (non-wildcard) path-scoped rule cannot match it', async () => {
    const policyStore = new PolicyStore([{ path: '$PWD', default: 'deny' }, { tool: '*', default: 'allow' }], lookup);
    const approve = createPolicyGatedApproval(policyStore, lookup, () => '/repo');

    const outcome = await approve({ name: 'UnknownTool', operation: 'fs.exec', input: { path: '/anything' }, batch: [] });

    expect(outcome.approved).toBe(true);
  });
});
