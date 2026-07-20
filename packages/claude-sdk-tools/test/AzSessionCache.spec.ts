import type { PassThrough } from 'node:stream';
import { rm } from 'node:fs/promises';
import type { CommandSpec, ExitStatus, IExecutor, SpawnOpts } from '@shellicar/exec-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AzSessionCache } from '../src/Az/AzSessionCache';
import type { AzDeps } from '../src/Az/runAz';

// Resolves each `run()` call on demand rather than immediately, so a test can control the
// order two concurrent `az login` sequences complete in.
class ControllableExecutor implements IExecutor {
  public readonly calls: Array<{ cmd: CommandSpec; opts?: SpawnOpts }> = [];
  readonly #pending: Array<(status: ExitStatus) => void> = [];

  public run(cmd: CommandSpec, opts?: SpawnOpts): Promise<ExitStatus> {
    return new Promise((resolve) => {
      this.calls.push({ cmd, opts });
      this.#pending.push(resolve);
    });
  }

  public async resolve(index: number, stdout = ''): Promise<void> {
    const call = this.calls[index];
    const out = call?.opts?.stdout as PassThrough | undefined;
    if (out != null) {
      await new Promise<void>((res) => {
        out.on('end', res);
        out.end(stdout);
      });
    }
    call?.opts?.stderr?.end();
    this.#pending[index]?.({ exitCode: 0, signal: null });
  }
}

function makeDeps(executor: IExecutor): AzDeps {
  return {
    executor,
    getCert: () => 'cert-pem',
    getClientId: () => 'client-id',
    getTenantId: () => 'tenant-id',
  };
}

function tokenJson(expiresAtMs: number): string {
  return JSON.stringify({ expires_on: Math.floor(expiresAtMs / 1000) });
}

async function waitForCallCount(executor: ControllableExecutor, n: number): Promise<void> {
  while (executor.calls.length < n) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe('AzSessionCache — background refresh vs hard-expiry relogin race', () => {
  const configDirs: string[] = [];

  afterEach(async () => {
    vi.useRealTimers();
    await Promise.all(configDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => {})));
  });

  // A background refresh started at the 50% mark is meant to be a non-blocking courtesy: if a
  // caller crosses hardExpireAt before it finishes, that caller synchronously relogs in and its
  // session is the one that should be current. AzSessionCache#backgroundRefresh instead lands its
  // own result with an unconditional `entries.set(...)`, clobbering the newer hard-expiry login if
  // it finishes after it — so a caller can be served a session that is one full cycle stale even
  // though a fresher one was already obtained.
  it('serves the hard-expiry relogin, not a background refresh that lands after it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const executor = new ControllableExecutor();
    const deps = makeDeps(executor);
    const cache = new AzSessionCache();

    // Cold start at t=0: a 1000ms-lifetime token, so refreshAt=500, hardExpireAt=750.
    vi.setSystemTime(0);
    const coldPromise = cache.getSession(deps, 'reader', 'acct', '/cwd');
    await waitForCallCount(executor, 1);
    await executor.resolve(0);
    await waitForCallCount(executor, 2);
    await executor.resolve(1, tokenJson(1000));
    const sessionA = await coldPromise;
    if ('loginFailed' in sessionA) {
      throw new Error('unreachable');
    }
    configDirs.push(sessionA.configDir);

    // t=600: past refreshAt (500), before hardExpireAt (750) — starts a background refresh.
    // Its login/token calls (indices 2 and 3) are deliberately left unresolved: this is the slow
    // background attempt that will land last.
    vi.setSystemTime(600);
    const duringRefreshWindow = await cache.getSession(deps, 'reader', 'acct', '/cwd');
    if ('loginFailed' in duringRefreshWindow) {
      throw new Error('unreachable');
    }
    // Only the background refresh's login call (index 2) registers yet; its token call (index 3)
    // won't be issued until that login resolves, which this test deliberately delays.
    await waitForCallCount(executor, 3);

    // t=800: past hardExpireAt (750) — a synchronous relogin, independent of the still-pending
    // background refresh above. The refresh's own token call (which would occupy index 3) never
    // registers until its login at index 2 resolves, which this test is deliberately withholding —
    // so this relogin's login/token calls land at indices 3 and 4, not 4 and 5.
    vi.setSystemTime(800);
    const hardExpiryPromise = cache.getSession(deps, 'reader', 'acct', '/cwd');
    await waitForCallCount(executor, 4);
    await executor.resolve(3);
    await waitForCallCount(executor, 5);
    await executor.resolve(4, tokenJson(800 + 1000));
    const sessionC = await hardExpiryPromise;
    if ('loginFailed' in sessionC) {
      throw new Error('unreachable');
    }
    configDirs.push(sessionC.configDir);

    // Now let the earlier, slower background refresh land, after the hard-expiry relogin already
    // replaced the cache entry. Its token call only registers once this login resolves, landing at
    // index 5 (everything up to 4 is already taken by the cold start and the hard-expiry relogin).
    await executor.resolve(2);
    await waitForCallCount(executor, 6);
    await executor.resolve(5, tokenJson(600 + 1000));
    // Let the background refresh's own .then() run and land its entries.set(...).
    await new Promise((resolve) => setImmediate(resolve));

    const served = await cache.getSession(deps, 'reader', 'acct', '/cwd');
    if ('loginFailed' in served) {
      throw new Error('unreachable');
    }

    const expected = sessionC.configDir;
    const actual = served.configDir;
    expect(actual).toBe(expected);
  });
});
