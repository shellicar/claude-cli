import type { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { IObjectStore } from '@shellicar/claude-core/persistence/interfaces';
import { resolveTsServerPath } from '@shellicar/claude-sdk-tools/TsService';
import { buildContainer } from '../setup/container.js';

type Log = (msg: string) => void;

/**
 * Exit codes for `--verify`. Distinct so CI (and Claude, which can't easily
 * drive the interactive CLI) can tell the three states apart from the code
 * alone: a degraded run still booted, so it is not the same as a hard failure.
 */
export const VERIFY_EXIT = {
  /** Booted, and typescript resolved: the full tool suite is available. */
  clean: 0,
  /** Could not boot the composition root (e.g. the node:sqlite store failed). */
  hardFailure: 1,
  /** Booted, but typescript/the TS server is unavailable, so TS tools degrade. */
  degraded: 2,
} as const;

export type VerifyOptions = {
  // Mirrors ContainerOptions: the config schema is generic, so the loader is
  // carried as ConfigLoader<any> throughout the composition root.
  configLoader: ConfigLoader<any>;
  modelOverride: string | null;
  systemFlagText: string | null;
};

/**
 * Resolve the composition root and report whether the CLI can launch, with a
 * distinct exit code per state. This is the acceptance bar that exercises a
 * real boot (config load, container, the node:sqlite store) without needing an
 * interactive terminal. It surfaces a missing typescript loudly, instead of
 * letting the graceful degradation hide it.
 */
export async function runVerify(options: VerifyOptions, log: Log): Promise<number> {
  const { configLoader, modelOverride, systemFlagText } = options;

  try {
    configLoader.load();
    const provider = buildContainer({ configLoader, modelOverride, systemFlagText });
    // Constructing the store opens node:sqlite and configures the database,
    // the path that historically crashed on a mismatched Node ABI.
    provider.resolve(IObjectStore);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log('claude-sdk-cli --verify: HARD FAILURE');
    log(`  cannot boot: ${message}`);
    return VERIFY_EXIT.hardFailure;
  }

  const tsserverPath = resolveTsServerPath();
  if (tsserverPath == null) {
    log('claude-sdk-cli --verify: DEGRADED');
    log('  store: ok');
    log('  typescript: not found. TS tools unavailable, CLI still boots');
    return VERIFY_EXIT.degraded;
  }

  log('claude-sdk-cli --verify: OK');
  log('  store: ok');
  log(`  typescript: ${tsserverPath}`);
  return VERIFY_EXIT.clean;
}
