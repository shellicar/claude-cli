import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

/**
 * Env var the launcher sets to the on-disk keychain-native module path. Inside the SEA,
 * import.meta.url is a virtual path with no node_modules beside it, so the binary cannot
 * resolve @shellicar/keychain-native itself; the launcher (running on the user's Node, with
 * a real path) resolves it and hands the path in through this var. Mirrors TSSERVER_PATH_ENV.
 */
export const KEYCHAIN_NATIVE_PATH_ENV = 'CLAUDE_SDK_CLI_KEYCHAIN_NATIVE_PATH';

/**
 * Resolve the on-disk path to the keychain-native module's entry, or null when it cannot be
 * found. Prefers the launcher-provided env var (the SEA case); falls back to resolving the
 * package relative to this module (the dev / npm-with-node_modules case). Returns a real path
 * either way, so the caller's own require() of it, and that entry's internal relative require
 * of the platform .node file, both resolve against real disk locations regardless of the
 * virtual module context the caller is running in.
 */
export function resolveKeychainNativePath(): string | null {
  const fromEnv = process.env[KEYCHAIN_NATIVE_PATH_ENV];
  if (fromEnv != null && fromEnv !== '') {
    return existsSync(fromEnv) ? fromEnv : null;
  }
  try {
    const require = createRequire(import.meta.url);
    return require.resolve('@shellicar/keychain-native');
  } catch {
    return null;
  }
}
