import { cliConfigSchema } from './schema';
import type { ResolvedCliConfig } from './types';

function diffDeep(prefix: string, a: unknown, b: unknown, changes: string[]): void {
  if (typeof a === 'object' && a !== null && !Array.isArray(a)) {
    for (const key of Object.keys(a as object)) {
      diffDeep(`${prefix}.${key}`, (a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], changes);
    }
  } else if (JSON.stringify(a) !== JSON.stringify(b)) {
    changes.push(`${prefix}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
  }
}

export function diffConfig(prev: ResolvedCliConfig, next: ResolvedCliConfig): string[] {
  const changes: string[] = [];

  for (const key of Object.keys(cliConfigSchema.shape)) {
    if (key === '$schema') {
      continue;
    }
    diffDeep(key, prev[key as keyof ResolvedCliConfig], next[key as keyof ResolvedCliConfig], changes);
  }

  return changes;
}
