import { existsSync, readFileSync } from 'node:fs';
import { CONFIG_PATH } from './consts';
import { cliConfigSchema } from './schema';
import type { ResolvedCliConfig } from './types';

export function loadCliConfig(): { config: ResolvedCliConfig; warnings: string[]; path: string | null } {
  const defaults = cliConfigSchema.parse({});

  if (!existsSync(CONFIG_PATH)) {
    return { config: defaults, warnings: [], path: null };
  }

  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    const config = cliConfigSchema.parse(raw);
    return { config, warnings: [], path: CONFIG_PATH };
  } catch {
    return { config: defaults, warnings: [`Failed to parse ${CONFIG_PATH}`], path: CONFIG_PATH };
  }
}
