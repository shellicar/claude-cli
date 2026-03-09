import type { z } from 'zod';
import { cliConfigSchema } from './schema';

export function validateRawConfig(raw: Record<string, unknown>): string[] {
  const warnings: string[] = [];

  for (const [key, fieldSchema] of Object.entries(cliConfigSchema.shape)) {
    if (key === '$schema' || !(key in raw)) {
      continue;
    }
    const rawVal = raw[key];

    if (key === 'providers') {
      if (typeof rawVal !== 'object' || rawVal === null || Array.isArray(rawVal)) {
        warnings.push(`providers: ${JSON.stringify(rawVal)} is invalid, using defaults`);
        continue;
      }
      const rawProviders = rawVal as Record<string, unknown>;
      const parsedProviders = (fieldSchema as z.ZodTypeAny).parse(rawProviders) as Record<string, Record<string, unknown>>;
      for (const group of ['git', 'usage'] as const) {
        if (!(group in rawProviders)) {
          continue;
        }
        const rawGroup = rawProviders[group];
        if (typeof rawGroup !== 'object' || rawGroup === null || Array.isArray(rawGroup)) {
          warnings.push(`providers.${group}: ${JSON.stringify(rawGroup)} is invalid, using defaults`);
          continue;
        }
        const parsedGroup = parsedProviders[group];
        for (const [k, v] of Object.entries(rawGroup as Record<string, unknown>)) {
          if (JSON.stringify(v) !== JSON.stringify(parsedGroup[k])) {
            warnings.push(`providers.${group}.${k}: ${JSON.stringify(v)} is invalid, using: ${JSON.stringify(parsedGroup[k])}`);
          }
        }
      }
      continue;
    }

    const coerced = (fieldSchema as z.ZodTypeAny).parse(rawVal);
    if (JSON.stringify(rawVal) !== JSON.stringify(coerced)) {
      warnings.push(`${key}: ${JSON.stringify(rawVal)} is invalid, using: ${JSON.stringify(coerced)}`);
    }
  }

  return warnings;
}
