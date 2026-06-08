import type { ResolvedSdkConfig } from './types';

/**
 * Render the effective (merged) config for the startup display, shown when
 * --config was passed so the user can see how it resolved. The model is the
 * effective model (the --model slot over the config value), passed in by the
 * caller so this stays a pure formatter.
 */
export function formatEffectiveConfig(config: ResolvedSdkConfig): string {
  return `effective config:\n${JSON.stringify(config)}`;
}
