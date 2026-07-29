import { Clock } from '@js-joda/core';
import type { Stream } from '@shellicar/orchestrate-core';
import { describe, expect, it } from 'vitest';
import { AzSessionCache } from '../../src/Az/AzSessionCache.js';
import type { AzDeps } from '../../src/Az/runAz.js';
import { createAzToolsV2 } from '../../src/Orchestrate/tools/Az.js';
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

describe('Az V2', () => {
  it('AzCli (reader) maps onto fs.write, the closest tier to V1s generic write tag', () => {
    const [AzCli] = createAzToolsV2(makeDeps(new FakeExecutor()), () => ({}), new AzSessionCache(Clock.systemUTC()));

    expect(AzCli.name).toBe('AzCli');
    expect(AzCli.operation).toBe('fs.write');
  });

  it('EscalatedAzCli is escalate — always gated, never a pre-trustable fs.* tier', () => {
    const [, EscalatedAzCli] = createAzToolsV2(makeDeps(new FakeExecutor()), () => ({}), new AzSessionCache(Clock.systemUTC()));

    expect(EscalatedAzCli.name).toBe('EscalatedAzCli');
    expect(EscalatedAzCli.operation).toBe('escalate');
  });

  it('runs the given args against the sole configured reader account', async () => {
    const executor = new FakeExecutor(() => ({ stdout: '[]\n', exitCode: 0 }));
    const cache = new AzSessionCache(Clock.systemUTC());
    const [AzCli] = createAzToolsV2(makeDeps(executor), () => ({ acct: { tenantId: 't', reader: { type: 'cert', clientId: 'c', subscriptionIds: [] }, holder: null } }), cache);

    const result = AzCli.run({ args: ['group', 'list'] }, undefined, []);
    const lines = await drain(result.stdout);

    expect(result.success()).toBe(true);
    expect(lines).toEqual(['[]']);
    expect(executor.calls.find((c) => c.args?.[0] === 'group')?.args).toEqual(['group', 'list']);
  });
});
