import { rm } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Clock, ZoneOffset } from '@js-joda/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AzSessionCache } from '../src/Az/AzSessionCache';
import type { AzDeps } from '../src/Az/runAz';
import type { AzIdentityConfig } from '../src/Az/tools';
import { FakeExecutor } from './FakeExecutor';

class FixedClock extends Clock {
  public instant() {
    return Clock.systemUTC().instant();
  }
  public millis() {
    return 0;
  }
  public withZone(): Clock {
    return this;
  }
  public zone() {
    return ZoneOffset.UTC;
  }
  public equals(other: unknown): boolean {
    return other === this;
  }
}

function makeDeps(identity: AzIdentityConfig, executor: FakeExecutor): AzDeps {
  return {
    executor,
    getCert: () => 'cert-pem',
    getIdentity: () => identity,
    getTenantId: () => 'tenant-id',
  };
}

function loginCalls(executor: FakeExecutor) {
  return executor.calls.filter((c) => c.program === 'az' && c.args?.[0] === 'login');
}

describe('AzSessionCache — mechanism branching', () => {
  // The interactive mechanism creates a real, stable data-dir entry (not a throwaway temp dir,
  // by design — see ensureAzInteractiveSessionDir). Pointing XDG_DATA_HOME at a scratch dir for
  // the duration of these tests keeps that real side effect off the actual host data dir.
  let previousXdgDataHome: string | undefined;
  let scratchDataDir: string;
  const ephemeralConfigDirs: string[] = [];

  beforeEach(async () => {
    previousXdgDataHome = process.env.XDG_DATA_HOME;
    scratchDataDir = await mkdtemp(join(tmpdir(), 'az-session-cache-test-'));
    process.env.XDG_DATA_HOME = scratchDataDir;
  });

  afterEach(async () => {
    if (previousXdgDataHome == null) {
      delete process.env.XDG_DATA_HOME;
    } else {
      process.env.XDG_DATA_HOME = previousXdgDataHome;
    }
    await rm(scratchDataDir, { recursive: true, force: true });
    await Promise.all(ephemeralConfigDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => {})));
  });

  it('passes --tenant but no --service-principal for an interactive identity', async () => {
    const executor = new FakeExecutor(() => ({ exitCode: 0 }));
    const cache = new AzSessionCache(new FixedClock());
    const deps = makeDeps({ type: 'interactive', subscriptionIds: [] }, executor);

    await cache.getSession(deps, 'reader', 'acct', '/cwd');

    const [call] = loginCalls(executor);
    expect(call.args).toEqual(['login', '--tenant', 'tenant-id']);
  });

  it('passes --service-principal and --certificate for a cert identity with no subscriptionIds', async () => {
    const executor = new FakeExecutor(() => ({ exitCode: 0 }));
    const cache = new AzSessionCache(new FixedClock());
    const deps = makeDeps({ type: 'cert', clientId: 'client-1', subscriptionIds: [] }, executor);

    const session = await cache.getSession(deps, 'reader', 'acct', '/cwd');
    if ('configDir' in session) {
      ephemeralConfigDirs.push(session.configDir);
    }

    const [call] = loginCalls(executor);
    expect(call.args).toEqual(['login', '--tenant', 'tenant-id', '--service-principal', '-u', 'client-1', '--certificate', expect.stringContaining('cert.pem'), '--allow-no-subscriptions']);
  });

  it('loops one login per configured subscription id, skipping discovery, without --allow-no-subscriptions', async () => {
    const executor = new FakeExecutor(() => ({ exitCode: 0 }));
    const cache = new AzSessionCache(new FixedClock());
    const deps = makeDeps({ type: 'interactive', subscriptionIds: ['sub-1', 'sub-2'] }, executor);

    await cache.getSession(deps, 'reader', 'acct', '/cwd');

    const calls = loginCalls(executor);
    expect(calls).toEqual([
      { program: 'az', args: ['login', '--tenant', 'tenant-id', '--skip-subscription-discovery', '--subscription', 'sub-1'], cwd: '/cwd', env: expect.anything() },
      { program: 'az', args: ['login', '--tenant', 'tenant-id', '--skip-subscription-discovery', '--subscription', 'sub-2'], cwd: '/cwd', env: expect.anything() },
    ]);
  });

  it('stops the subscription loop on the first failing login and reports it', async () => {
    let calls = 0;
    const executor = new FakeExecutor(() => {
      calls += 1;
      return { exitCode: calls === 1 ? 1 : 0 };
    });
    const cache = new AzSessionCache(new FixedClock());
    const deps = makeDeps({ type: 'interactive', subscriptionIds: ['sub-1', 'sub-2'] }, executor);

    const session = await cache.getSession(deps, 'reader', 'acct', '/cwd');

    expect('loginFailed' in session).toBe(true);
    expect(loginCalls(executor)).toHaveLength(1);
  });
});
