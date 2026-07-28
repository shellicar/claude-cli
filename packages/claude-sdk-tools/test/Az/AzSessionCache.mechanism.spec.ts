import { Clock, ZoneOffset } from '@js-joda/core';
import { describe, expect, it } from 'vitest';
import { AzSessionCache } from '../../src/Az/AzSessionCache';
import type { AzDeps } from '../../src/Az/runAz';
import type { AzIdentityConfig } from '../../src/Az/tools';
import { FakeExecutor } from '../FakeExecutor';
import { MemoryFileSystem } from '../MemoryFileSystem';

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

// A settable clock, for the one test here that needs time to actually cross refreshAt.
class MutableClock extends Clock {
  #millis: number;
  public constructor(initialMillis: number) {
    super();
    this.#millis = initialMillis;
  }
  public set(millis: number): void {
    this.#millis = millis;
  }
  public instant() {
    return Clock.systemUTC().instant();
  }
  public millis(): number {
    return this.#millis;
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

function tokenJson(expiresAtMs: number): string {
  return JSON.stringify({ expires_on: Math.floor(expiresAtMs / 1000) });
}

describe('AzSessionCache — mechanism branching', () => {
  it('passes --tenant but no --service-principal for an interactive identity', async () => {
    const executor = new FakeExecutor(() => ({ exitCode: 0 }));
    const cache = new AzSessionCache(new MemoryFileSystem(), new FixedClock());
    const deps = makeDeps({ type: 'interactive', subscriptionIds: [] }, executor);

    await cache.getSession(deps, 'reader', 'acct', '/cwd');

    const [call] = loginCalls(executor);
    expect(call.args).toEqual(['login', '--tenant', 'tenant-id']);
  });

  it('passes --service-principal and --certificate for a cert identity with no subscriptionIds', async () => {
    const executor = new FakeExecutor(() => ({ exitCode: 0 }));
    const cache = new AzSessionCache(new MemoryFileSystem(), new FixedClock());
    const deps = makeDeps({ type: 'cert', clientId: 'client-1', subscriptionIds: [] }, executor);

    await cache.getSession(deps, 'reader', 'acct', '/cwd');

    const [call] = loginCalls(executor);
    expect(call.args).toEqual(['login', '--tenant', 'tenant-id', '--service-principal', '-u', 'client-1', '--certificate', expect.stringContaining('cert.pem'), '--allow-no-subscriptions']);
  });

  it('loops one login per configured subscription id, skipping discovery, without --allow-no-subscriptions', async () => {
    const executor = new FakeExecutor(() => ({ exitCode: 0 }));
    const cache = new AzSessionCache(new MemoryFileSystem(), new FixedClock());
    const deps = makeDeps({ type: 'interactive', subscriptionIds: ['sub-1', 'sub-2'] }, executor);

    await cache.getSession(deps, 'reader', 'acct', '/cwd');

    const calls = loginCalls(executor);
    expect(calls).toEqual([
      { program: 'az', args: ['login', '--tenant', 'tenant-id', '--skip-subscription-discovery', '--subscription', 'sub-1'], cwd: '/cwd', env: expect.anything() },
      { program: 'az', args: ['login', '--tenant', 'tenant-id', '--skip-subscription-discovery', '--subscription', 'sub-2'], cwd: '/cwd', env: expect.anything() },
    ]);
  });

  it('stops the subscription loop on the first failing login and reports it', async () => {
    let loginAttempts = 0;
    const executor = new FakeExecutor((cmd) => {
      if (cmd.program === 'az' && cmd.args?.[0] === 'login') {
        loginAttempts += 1;
        return { exitCode: loginAttempts === 1 ? 1 : 0 };
      }
      return { exitCode: 0 };
    });
    const cache = new AzSessionCache(new MemoryFileSystem(), new FixedClock());
    const deps = makeDeps({ type: 'interactive', subscriptionIds: ['sub-1', 'sub-2'] }, executor);

    const session = await cache.getSession(deps, 'reader', 'acct', '/cwd');

    expect('loginFailed' in session).toBe(true);
    expect(loginCalls(executor)).toHaveLength(1);
  });

  it('strips ambient Azure credential env vars from the login env', async () => {
    const executor = new FakeExecutor(() => ({ exitCode: 0 }));
    const cache = new AzSessionCache(new MemoryFileSystem(), new FixedClock());
    const deps = makeDeps({ type: 'interactive', subscriptionIds: [] }, executor);
    const previous = process.env.AZURE_CLIENT_SECRET;
    process.env.AZURE_CLIENT_SECRET = 'ambient-secret';

    try {
      await cache.getSession(deps, 'reader', 'acct', '/cwd');
    } finally {
      if (previous == null) {
        delete process.env.AZURE_CLIENT_SECRET;
      } else {
        process.env.AZURE_CLIENT_SECRET = previous;
      }
    }

    const [call] = loginCalls(executor);
    expect(call.env.AZURE_CLIENT_SECRET).toBeUndefined();
  });

  it('never starts a background refresh for an interactive identity crossing refreshAt', async () => {
    const executor = new FakeExecutor(() => ({ exitCode: 0, stdout: tokenJson(1000) }));
    const clock = new MutableClock(0);
    const cache = new AzSessionCache(new MemoryFileSystem(), clock);
    const deps = makeDeps({ type: 'interactive', subscriptionIds: [] }, executor);

    await cache.getSession(deps, 'reader', 'acct', '/cwd');
    const loginsAfterColdStart = loginCalls(executor).length;

    // Past refreshAt (500 = 50% of the 1000ms token lifetime) but before hardExpireAt (750).
    clock.set(600);
    await cache.getSession(deps, 'reader', 'acct', '/cwd');
    // Give any wrongly-started background refresh a turn to actually issue its call.
    await new Promise((resolve) => setImmediate(resolve));

    const loginsAfterRefreshWindow = loginCalls(executor).length;
    expect(loginsAfterRefreshWindow).toBe(loginsAfterColdStart);
  });

  it('reuses an existing interactive session from disk instead of logging in again', async () => {
    const executor = new FakeExecutor((cmd) => {
      if (cmd.program === 'az' && cmd.args?.[0] === 'account' && cmd.args?.[1] === 'list') {
        return { exitCode: 0, stdout: '1' };
      }
      if (cmd.program === 'az' && cmd.args?.[0] === 'account' && cmd.args?.[1] === 'get-access-token') {
        return { exitCode: 0, stdout: tokenJson(1000) };
      }
      return { exitCode: 0 };
    });
    const cache = new AzSessionCache(new MemoryFileSystem(), new FixedClock());
    const deps = makeDeps({ type: 'interactive', subscriptionIds: [] }, executor);

    await cache.getSession(deps, 'reader', 'acct', '/cwd');

    expect(loginCalls(executor)).toHaveLength(0);
  });

  it('logs in when the interactive account-list probe finds nothing for the configured tenant', async () => {
    const executor = new FakeExecutor((cmd) => {
      if (cmd.program === 'az' && cmd.args?.[0] === 'account' && cmd.args?.[1] === 'list') {
        return { exitCode: 0, stdout: '0' };
      }
      return { exitCode: 0 };
    });
    const cache = new AzSessionCache(new MemoryFileSystem(), new FixedClock());
    const deps = makeDeps({ type: 'interactive', subscriptionIds: [] }, executor);

    await cache.getSession(deps, 'reader', 'acct', '/cwd');

    expect(loginCalls(executor)).toHaveLength(1);
  });
});
