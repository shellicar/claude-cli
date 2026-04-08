import { mergeRawConfigs as coreMergeRawConfigs, loadConfig } from '@shellicar/claude-core/config';
import { CONFIG_PATH, LOCAL_CONFIG_PATH } from './consts';
import { cliConfigSchema } from './schema';
import type { ResolvedCliConfig } from './types';

/** @private Exported for testing only. */
export function mergeRawConfigs(home: Record<string, unknown>, local: Record<string, unknown>): Record<string, unknown> {
  return coreMergeRawConfigs(home, local, { additivePaths: ['execPermissions.approve'] });
}

export function loadCliConfig(): { config: ResolvedCliConfig; warnings: string[]; paths: string[] } {
  return loadConfig(cliConfigSchema, CONFIG_PATH, LOCAL_CONFIG_PATH, { additivePaths: ['execPermissions.approve'] }) as { config: ResolvedCliConfig; warnings: string[]; paths: string[] };
}
