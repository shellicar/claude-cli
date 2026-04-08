import { loadConfig } from '@shellicar/claude-core/config';
import { CONFIG_PATH, LOCAL_CONFIG_PATH } from './consts';
import { sdkConfigSchema } from './schema';
import type { ResolvedSdkConfig } from './types';

export function loadCliConfig(): { config: ResolvedSdkConfig; warnings: string[]; paths: string[] } {
  return loadConfig(sdkConfigSchema, CONFIG_PATH, LOCAL_CONFIG_PATH) as { config: ResolvedSdkConfig; warnings: string[]; paths: string[] };
}
