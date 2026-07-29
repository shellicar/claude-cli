import { tmpdir } from 'node:os';
import { Clock } from '@js-joda/core';
import type { Stream } from '@shellicar/orchestrate-core';
import { describe, expect, it } from 'vitest';
import { AzSessionCache } from '../../src/Az/AzSessionCache.js';
import type { AzDeps } from '../../src/Az/runAz.js';
import { createAdoPrToolsV2 } from '../../src/Orchestrate/tools/AzureDevOps.js';
import { FakeExecutor } from '../FakeExecutor.js';

async function drain(stream: Stream<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const value of stream) {
    out.push(value);
  }
  return out;
}

function makeDeps(executor: FakeExecutor): AzDeps {
  return { executor, getCert: () => 'cert', getIdentity: () => ({ type: 'cert', clientId: 'client-id', subscriptionIds: [] }), getTenantId: () => 'tenant-id' };
}

describe('AzureDevOps V2', () => {
  it('every tool is registered as escalate — always gated, never a pre-trustable fs.* tier', () => {
    const executor = new FakeExecutor();
    const tools = createAdoPrToolsV2(makeDeps(executor), () => ({ acct: { tenantId: 't', reader: null, holder: { type: 'cert', clientId: 'c', subscriptionIds: [] } } }), new AzSessionCache(Clock.systemUTC()));

    expect(tools.map((t) => t.operation)).toEqual(tools.map(() => 'escalate'));
    expect(tools.map((t) => t.name)).toEqual(['AzureDevOps_PullRequest_Create', 'AzureDevOps_PullRequest_Ready', 'AzureDevOps_PullRequest_Edit', 'AzureDevOps_PullRequest_AutoMerge', 'AzureDevOps_PullRequest_ReviewerAdd', 'AzureDevOps_PullRequest_ReviewerRemove', 'AzureDevOps_PullRequest_Vote']);
  });

  it('runs the Ready tool against the sole configured holder account, in a directory with no git remote', async () => {
    const executor = new FakeExecutor(() => ({ stdout: 'ok\n', exitCode: 0 }));
    const cache = new AzSessionCache(Clock.systemUTC());
    const [Create, Ready] = createAdoPrToolsV2(makeDeps(executor), () => ({ acct: { tenantId: 't', reader: null, holder: { type: 'cert', clientId: 'c', subscriptionIds: [] } } }), cache);
    void Create;

    const result = Ready.run({ id: 42, cwd: tmpdir() }, undefined, []);
    const lines = await drain(result.stdout);

    expect(result.success()).toBe(true);
    expect(lines).toEqual(['ok']);
    const prCall = executor.calls.find((c) => c.args?.[0] === 'repos');
    expect(prCall?.args).toEqual(['repos', 'pr', 'update', '--id', '42', '--draft', 'false']);
  });
});
