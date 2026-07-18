import type { ResolvedSdkConfig } from './types';

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Project `override` (the raw --config payload) onto `config` (the resolved
 * merge), keeping only the keys --config actually named. A key --config sent
 * that the schema doesn't recognise (e.g. a typo) has no counterpart in
 * `config` and is dropped — it caused no effect, so it shouldn't appear.
 * Nested objects recurse so a partial override (e.g. one hook field) only
 * surfaces that field, not the whole parent object.
 */
export function pickOverriddenConfig(config: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, overrideValue] of Object.entries(override)) {
    if (!(key in config)) {
      continue;
    }
    const configValue = config[key];
    result[key] = isPlainObject(overrideValue) && isPlainObject(configValue) ? pickOverriddenConfig(configValue, overrideValue) : configValue;
  }
  return result;
}

/**
 * Render the config keys --config actually affected, for the startup display
 * shown when --config was passed. Not the full merged config — only the
 * projection of `override`'s shape onto the resolved values, so the user sees
 * exactly what their --config payload caused. The model is the effective
 * model (the --model slot over the config value), passed in by the caller so
 * this stays a pure formatter.
 */
export function formatEffectiveConfig(config: ResolvedSdkConfig, override: Record<string, unknown>): string {
  const effective = pickOverriddenConfig(config as unknown as Record<string, unknown>, override);
  return `effective config:\n${JSON.stringify(effective)}`;
}
