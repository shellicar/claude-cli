import { existsSync, readFileSync } from 'node:fs';
import { CONFIG_PATH, LOCAL_CONFIG_PATH } from './consts';
import { cliConfigSchema } from './schema';
import type { ResolvedCliConfig } from './types';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** @private Exported for testing only. */
export function mergeRawConfigs(home: Record<string, unknown>, local: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...home };

  for (const [key, value] of Object.entries(local)) {
    if (value === null) {
      delete merged[key];
    } else if (isPlainObject(value) && isPlainObject(merged[key])) {
      const mergedSub: Record<string, unknown> = { ...(merged[key] as Record<string, unknown>) };
      for (const [sk, sv] of Object.entries(value)) {
        if (sv === null) {
          delete mergedSub[sk];
        } else if (key === 'execPermissions' && sk === 'approve' && Array.isArray(sv) && Array.isArray(mergedSub[sk])) {
          mergedSub[sk] = [...(mergedSub[sk] as unknown[]), ...sv];
        } else {
          mergedSub[sk] = sv;
        }
      }
      merged[key] = mergedSub;
    } else {
      merged[key] = value;
    }
  }

  return merged;
}

function readRaw(path: string, warnings: string[]): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    warnings.push(`Failed to parse ${path}`);
    return {};
  }
}

export function loadCliConfig(): { config: ResolvedCliConfig; warnings: string[]; paths: string[] } {
  const warnings: string[] = [];
  const paths: string[] = [];

  let homeRaw: Record<string, unknown> = {};
  if (existsSync(CONFIG_PATH)) {
    paths.push(CONFIG_PATH);
    homeRaw = readRaw(CONFIG_PATH, warnings);
  }

  let localRaw: Record<string, unknown> = {};
  if (existsSync(LOCAL_CONFIG_PATH)) {
    paths.push(LOCAL_CONFIG_PATH);
    localRaw = readRaw(LOCAL_CONFIG_PATH, warnings);
  }

  const merged = mergeRawConfigs(homeRaw, localRaw);
  const config = cliConfigSchema.parse(merged);
  return { config, warnings, paths };
}
