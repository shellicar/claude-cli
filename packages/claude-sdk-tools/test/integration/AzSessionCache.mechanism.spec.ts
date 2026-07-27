import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Clock, ZoneOffset } from '@js-joda/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AzSessionCache } from '../../src/Az/AzSessionCache';
import type { AzDeps } from '../../src/Az/runAz';
import type { AzIdentityConfig } from '../../src/Az/tools';
import { FakeExecutor } from '../FakeExecutor';

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

// The interactive mechanism creates a real, stable data-dir entry, and the cert mechanism writes a
// real cert.pem into a real mkdtemp dir — both genuine disk operations, not fakeable without an
// injected filesystem seam, so this suite lives in the integration tier.
describe('AzSessionCache — mechanism branching', () => {
  let previousXdgDataHome: string | undefined;
  let scratchDataDir: string;
  const ephemeralConfigDirs: string[] = [];

  // Silences every test's stdout by default (several logins here are interactive, i.e. mirrored) —
  // the two mirror-specific tests below inspect this same spy's calls instead of the real stream.
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    previousXdgDataHome = process.env.XDG_DATA_HOME;
    scratchDataDir = await mkdtemp(join(tmpdir(), 'az-session-cache-test-'));
    process.env.XDG_DATA_HOME = scratchDataDir;
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(async () => {
    writeSpy.mockRestore();
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

  it('strips ambient Azure credential env vars from the login env', async () => {
    const executor = new FakeExecutor(() => ({ exitCode: 0 }));
    const cache = new AzSessionCache(new FixedClock());
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

  it('mirrors an interactive login\u2019s output to the CLI\u2019s own stdout, for a device-code prompt to be seen', async () => {
    const executor = new FakeExecutor(() => ({ exitCode: 0, stdout: 'To sign in, use a web browser to open the page https://microsoft.com/devicelogin and enter the code ABC123 to authenticate.\n' }));
    const cache = new AzSessionCache(new FixedClock());
    const deps = makeDeps({ type: 'interactive', subscriptionIds: [] }, executor);

    await cache.getSession(deps, 'reader', 'acct', '/cwd');
    await new Promise((resolve) => setImmediate(resolve));

    const mirrored = writeSpy.mock.calls.some(([chunk]: [unknown]) => String(chunk).includes('ABC123'));
    expect(mirrored).toBe(true);
  });

  it('does not mirror a cert login\u2019s output, since it never needs a human watching', async () => {
    const executor = new FakeExecutor(() => ({ exitCode: 0, stdout: 'silent cert login output\n' }));
    const cache = new AzSessionCache(new FixedClock());
    const deps = makeDeps({ type: 'cert', clientId: 'client-1', subscriptionIds: [] }, executor);

    const session = await cache.getSession(deps, 'reader', 'acct', '/cwd');
    if ('configDir' in session) {
      ephemeralConfigDirs.push(session.configDir);
    }
    await new Promise((resolve) => setImmediate(resolve));

    const mirrored = writeSpy.mock.calls.some(([chunk]: [unknown]) => String(chunk).includes('silent cert login output'));
    expect(mirrored).toBe(false);
  });

  it('never starts a background refresh for an interactive identity crossing refreshAt', async () => {
    const executor = new FakeExecutor(() => ({ exitCode: 0, stdout: tokenJson(1000) }));
    const clock = new MutableClock(0);
    const cache = new AzSessionCache(clock);
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
});
