import { cliConfigSchema } from './schema';
import type { ResolvedCliConfig } from './types';

/** @private Exported for testing only. */

export function parseCliConfig(raw: unknown): ResolvedCliConfig {
  return cliConfigSchema.parse(raw);
}
