import { createRequire } from 'node:module';
import { resolveKeychainNativePath } from './resolveKeychainNativePath.js';

/** The Keychain items created once, out of band, by the operator — never by the CLI itself. */
const GH_HOLDER_SERVICE = '@shellicar/credentials';
const GH_HOLDER_ACCOUNT = 'gh-holder';
const GH_READER_ACCOUNT = 'gh-reader';

type KeychainNativeBinding = { readGenericPassword: (service: string, account: string) => string };

const KEYCHAIN_READ_ATTEMPTS = 3;
const KEYCHAIN_RETRY_BASE_MS = 200;

/** Blocking sleep, not async: readKeychain is a synchronous native call on a synchronous call chain
 *  (ISecrets.ghHolderToken/ghReaderToken → EnvProvider.buildEnv → IExecutor.run's env argument),
 *  so a retry here has no async point to await from. Atomics.wait on a throwaway buffer is the
 *  standard way to block synchronously in Node without spinning the CPU. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Resolved lazily, not statically imported: a static import can't cross into a SEA blob
 *  (no on-disk node_modules for the bundler or the runtime resolver to find), so this goes
 *  through the same env-var/real-path indirection TsServerClient already uses for typescript.
 *
 *  Retries a transient Keychain denial (e.g. an approval prompt that briefly times out) with a
 *  short linear backoff, up to KEYCHAIN_READ_ATTEMPTS. Still fails closed: once attempts are
 *  exhausted, the last error propagates rather than being swallowed — this never falls back to
 *  running unauthenticated or with a cached value. */
function readKeychain(service: string, account: string): string {
  const path = resolveKeychainNativePath();
  if (path == null) {
    throw new Error('@shellicar/keychain-native could not be resolved (not installed, or the SEA launcher env var is unset)');
  }
  const binding = createRequire(import.meta.url)(path) as KeychainNativeBinding;

  let lastError: unknown;
  for (let attempt = 1; attempt <= KEYCHAIN_READ_ATTEMPTS; attempt++) {
    try {
      return binding.readGenericPassword(service, account);
    } catch (err) {
      lastError = err;
      if (attempt < KEYCHAIN_READ_ATTEMPTS) {
        sleepSync(KEYCHAIN_RETRY_BASE_MS * attempt);
      }
    }
  }
  throw lastError;
}

/** Credentials the CLI holds that exec must never see. Register abstract→concrete and depend on
 *  the abstract (DI rule). Read fresh from the Keychain on every call, never cached: a cached
 *  credential goes stale the moment it is rotated or revoked out of band, and a stale holder token
 *  is exactly the failure mode this design exists to avoid (see the tower bridge OAuth-caching
 *  incident — same bug, same fix: read the source, not a snapshot of it). */
export abstract class ISecrets {
  /** The PR-capable gh token. Throws if the holder Keychain item hasn't been created yet. */
  public abstract ghHolderToken(): string;
  /** The unprivileged gh token every ordinary exec call runs under (via `EnvProvider`). Holds
   *  Contents: read-write (it can push branches); has no Pull requests permission, so GitHub
   *  refuses any PR operation on it. Throws if the reader Keychain item hasn't been created yet. */
  public abstract ghReaderToken(): string;
}

export class Secrets extends ISecrets {
  public ghHolderToken(): string {
    return readKeychain(GH_HOLDER_SERVICE, GH_HOLDER_ACCOUNT);
  }

  public ghReaderToken(): string {
    return readKeychain(GH_HOLDER_SERVICE, GH_READER_ACCOUNT);
  }
}
