import { rmSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ILogger } from '@shellicar/claude-core/logging/ILogger';
import type { IExecutor } from '@shellicar/exec-core';
import { ensureAzExtensionDir, type RunResult, removeConfigDir, runOnce } from '../az-shared';
import type { AzDeps } from './runAz';

type Session = { configDir: string; extensionDir: string; refreshAt: number; hardExpireAt: number };
type Entry = { promise: Promise<Session | { loginFailed: RunResult }>; session?: Session; refreshing?: boolean };

// Standard proactive-refresh shape: a session is usable for 3/4 of the token's real lifetime, with a
// background relogin kicked off at the halfway point so a caller landing in the 50-75% window is
// never blocked on it. A caller landing past 75% — the background relogin never started, or hasn't
// finished — pays a synchronous relogin instead of risking a call against a token near expiry.
const REFRESH_FRACTION = 0.5;
const HARD_EXPIRE_FRACTION = 0.75;
// Used only when az doesn't report a parseable expiry — a conservative default AAD access-token lifetime.
const FALLBACK_LIFETIME_MS = 60 * 60 * 1000;

/** Caches one `az login` per (identity, account), reused across every tool-execution block for as
 *  long as the underlying token is fresh — not torn down per block. This is the same shape as a
 *  person running `az login` once and staying signed in: a live session at rest, bounded by the
 *  token's own expiry rather than by any block boundary.
 *
 *  A session is served as-is until `refreshAt` (50% of the token's real lifetime); a background
 *  relogin starts there so nothing ever waits on it, and the old session keeps serving every caller
 *  until the new one is ready and swapped in. Past `hardExpireAt` (75%) a call synchronously relogs
 *  in rather than risk a stale token — the backstop for a background relogin that never started or
 *  hasn't finished.
 *
 *  Every config dir this cache ever creates is tracked and swept on process exit (mirroring
 *  `Executor`'s pid reaping). A superseded dir from a relogin is never removed eagerly: a straggling
 *  `az` call that already holds the old session object could still be mid-flight against it.
 *
 *  `logger` is optional only so tests can construct this without one; every real caller supplies it —
 *  it's the only way to see the token's actual lifetime and confirm the refresh/hard-expire timing
 *  are firing where expected, since neither is visible from the tool's own output. */
export class AzSessionCache {
  readonly #entries = new Map<string, Entry>();
  readonly #allConfigDirs = new Set<string>();
  readonly #onExit: () => void;
  readonly #logger?: ILogger;

  public constructor(logger?: ILogger) {
    this.#logger = logger;
    this.#onExit = () => {
      for (const dir of this.#allConfigDirs) {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {
          // best-effort — the process is already exiting
        }
      }
    };
    process.on('exit', this.#onExit);
  }

  public getSession(deps: AzDeps, identity: 'reader' | 'holder', account: string, cwd: string): Promise<Session | { loginFailed: RunResult }> {
    const key = `${identity}:${account}`;
    const entry = this.#entries.get(key);
    const now = Date.now();

    if (entry == null) {
      this.#logger?.info('az_session_cache_miss', { key });
      return this.#login(deps, identity, account, cwd, key);
    }
    if (entry.session == null) {
      // Still resolving (or already failed and about to be evicted) — every caller shares the one
      // in-flight attempt rather than each starting its own.
      this.#logger?.debug('az_session_join_inflight', { key });
      return entry.promise;
    }
    if (now >= entry.session.hardExpireAt) {
      this.#logger?.info('az_session_hard_expired', { key, hardExpireAt: new Date(entry.session.hardExpireAt).toISOString() });
      return this.#login(deps, identity, account, cwd, key);
    }
    if (now >= entry.session.refreshAt && !entry.refreshing) {
      entry.refreshing = true;
      this.#logger?.info('az_session_background_refresh_started', { key, refreshAt: new Date(entry.session.refreshAt).toISOString() });
      // Pass the current entry so the completion can tell whether it's still the one being refreshed
      // (see #backgroundRefresh) — a hard-expiry relogin can replace this entry while the background
      // login is still in flight.
      void this.#backgroundRefresh(key, entry, deps, identity, account, cwd);
    }
    this.#logger?.debug('az_session_cache_hit', { key });
    return Promise.resolve(entry.session);
  }

  /** Cold-start / hard-expired path: replaces the cache entry immediately, so every caller from this
   *  point on waits on the new login — there is no valid old session left worth serving. */
  async #login(deps: AzDeps, identity: 'reader' | 'holder', account: string, cwd: string, key: string): Promise<Session | { loginFailed: RunResult }> {
    const promise = this.#doLogin(deps, identity, account, cwd, key);
    const entry: Entry = { promise };
    this.#entries.set(key, entry);
    const result = await promise;
    if ('loginFailed' in result) {
      this.#entries.delete(key);
      return result;
    }
    entry.session = result;
    return result;
  }

  /** Soft-refresh path (50-75% window): logs in without touching the cache until the new session is
   *  ready, so every caller in the meantime keeps getting the still-valid old session — the point of
   *  doing this in the background at all.
   *
   *  `staleEntry` is the entry this refresh set out to replace, captured by the caller before the
   *  login started. A hard-expiry relogin (`#login`) can replace the map entry for this key while
   *  this login is still in flight — it always wins immediately and unconditionally, since past
   *  `hardExpireAt` there is no valid old session left to preserve. If that happened, `this` login is
   *  now redundant: writing its result would clobber the newer, already-current session with an
   *  older one for no reason. So the write only happens if the entry for this key is still the exact
   *  one this refresh started from — nothing has superseded it in the meantime. */
  async #backgroundRefresh(key: string, staleEntry: Entry, deps: AzDeps, identity: 'reader' | 'holder', account: string, cwd: string): Promise<void> {
    const result = await this.#doLogin(deps, identity, account, cwd, key);
    const stillCurrent = this.#entries.get(key) === staleEntry;
    if ('loginFailed' in result) {
      // Leave whatever's serving now in place; clear the flag so a later call past refreshAt retries.
      // Only touch it if we're still the entry that set the flag — a superseding hard-expiry login
      // already owns a fresh entry with its own (false) refreshing state.
      this.#logger?.warn('az_session_background_refresh_failed', { key, exitCode: result.loginFailed.exitCode });
      if (stillCurrent) {
        staleEntry.refreshing = false;
      }
      return;
    }
    if (!stillCurrent) {
      this.#logger?.debug('az_session_background_refresh_discarded_stale', { key });
      await removeConfigDir(result.configDir);
      this.#allConfigDirs.delete(result.configDir);
      return;
    }
    this.#logger?.info('az_session_background_refresh_completed', { key });
    this.#entries.set(key, { promise: Promise.resolve(result), session: result });
  }

  async #doLogin(deps: AzDeps, identity: 'reader' | 'holder', account: string, cwd: string, key: string): Promise<Session | { loginFailed: RunResult }> {
    const configDir = await mkdtemp(join(tmpdir(), 'az-'));
    this.#allConfigDirs.add(configDir);
    const extensionDir = await ensureAzExtensionDir();
    const certPath = join(configDir, 'cert.pem');
    await writeFile(certPath, deps.getCert(account, identity), { mode: 0o600 });
    const clientId = deps.getClientId(account, identity);
    const tenantId = deps.getTenantId(account);
    const env = { ...process.env, AZURE_CONFIG_DIR: configDir, AZURE_EXTENSION_DIR: extensionDir };

    const loginStartedAt = Date.now();
    const login = await runOnce(deps.executor, 'az', ['login', '--service-principal', '-u', clientId, '--tenant', tenantId, '--certificate', certPath, '--allow-no-subscriptions'], cwd, env);
    if (login.exitCode !== 0) {
      await removeConfigDir(configDir);
      this.#allConfigDirs.delete(configDir);
      this.#logger?.warn('az_login_failed', { key, exitCode: login.exitCode, durationMs: Date.now() - loginStartedAt });
      return { loginFailed: login };
    }

    const loginAt = Date.now();
    const lifetimeMs = await this.#tokenLifetimeMs(deps.executor, cwd, env);
    const refreshAt = loginAt + lifetimeMs * REFRESH_FRACTION;
    const hardExpireAt = loginAt + lifetimeMs * HARD_EXPIRE_FRACTION;
    this.#logger?.info('az_login_succeeded', {
      key,
      loginDurationMs: loginAt - loginStartedAt,
      tokenLifetimeMs: lifetimeMs,
      tokenLifetimeMinutes: Math.round(lifetimeMs / 60_000),
      refreshAt: new Date(refreshAt).toISOString(),
      hardExpireAt: new Date(hardExpireAt).toISOString(),
    });
    return { configDir, extensionDir, refreshAt, hardExpireAt };
  }

  /** Reads the token's real lifetime so refresh/expiry are bounded by fact, not an assumption. Falls
   *  back to a conservative default if `az` can't report an expiry (older CLI, transient failure) —
   *  the fallback only ever makes the cache refresh sooner than a longer-lived real token needed. */
  async #tokenLifetimeMs(executor: IExecutor, cwd: string, env: NodeJS.ProcessEnv): Promise<number> {
    const result = await runOnce(executor, 'az', ['account', 'get-access-token', '--output', 'json'], cwd, env);
    if (result.exitCode !== 0) {
      this.#logger?.debug('az_token_lifetime_unavailable', { exitCode: result.exitCode, fallbackMs: FALLBACK_LIFETIME_MS });
      return FALLBACK_LIFETIME_MS;
    }
    try {
      const parsed = JSON.parse(result.stdout) as { expires_on?: number; expiresOn?: string };
      const expiresAtMs = parsed.expires_on != null ? parsed.expires_on * 1000 : parsed.expiresOn != null ? new Date(parsed.expiresOn.replace(' ', 'T')).getTime() : Number.NaN;
      const lifetimeMs = expiresAtMs - Date.now();
      if (!Number.isFinite(lifetimeMs) || lifetimeMs <= 0) {
        this.#logger?.debug('az_token_lifetime_unparseable', { raw: result.stdout, fallbackMs: FALLBACK_LIFETIME_MS });
        return FALLBACK_LIFETIME_MS;
      }
      return lifetimeMs;
    } catch {
      this.#logger?.debug('az_token_lifetime_unparseable', { raw: result.stdout, fallbackMs: FALLBACK_LIFETIME_MS });
      return FALLBACK_LIFETIME_MS;
    }
  }
}
