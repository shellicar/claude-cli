import { describe, expect, it } from 'vitest';
import { createPolicyGatedApproval } from '../../src/Orchestrate/policyGatedApproval.js';
import { PolicyStore } from '../../src/Policy/PolicyStore.js';

const lookup = { get: () => undefined };

describe('createPolicyGatedApproval', () => {
  it('approves without ever asking a human when the policy verdict is allow', async () => {
    const policyStore = new PolicyStore([{ tool: 'Program', default: 'allow' }], lookup);
    let humanAsked = false;
    const approve = createPolicyGatedApproval(policyStore, () => '/repo', async () => {
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
    const approve = createPolicyGatedApproval(policyStore, () => '/repo', async () => {
      humanAsked = true;
      return true;
    });

    const outcome = await approve({ name: 'Program', operation: 'fs.exec', input: {}, batch: [] });

    expect(outcome.approved).toBe(false);
    expect(humanAsked).toBe(false);
  });

  it('falls through to the human-ask callback when the policy verdict is ask', async () => {
    const policyStore = new PolicyStore([{ tool: 'Program', default: 'ask' }], lookup);
    const approve = createPolicyGatedApproval(policyStore, () => '/repo', async () => true);

    const outcome = await approve({ name: 'Program', operation: 'fs.exec', input: {}, batch: [] });

    expect(outcome.approved).toBe(true);
  });

  it('auto-approves an ask verdict when no human-ask callback was supplied at all', async () => {
    const policyStore = new PolicyStore([{ tool: 'Program', default: 'ask' }], lookup);
    const approve = createPolicyGatedApproval(policyStore, () => '/repo');

    const outcome = await approve({ name: 'Program', operation: 'fs.exec', input: {}, batch: [] });

    expect(outcome.approved).toBe(true);
  });

  it('carries the policy message through on a denial', async () => {
    const policyStore = new PolicyStore([{ tool: 'Program', default: 'deny', message: 'blocked by policy' }], lookup);
    const approve = createPolicyGatedApproval(policyStore, () => '/repo');

    const outcome = await approve({ name: 'Program', operation: 'fs.exec', input: {}, batch: [] });

    expect(outcome.approved).toBe(false);
    expect(!outcome.approved && outcome.message).toBe('blocked by policy');
  });
});
