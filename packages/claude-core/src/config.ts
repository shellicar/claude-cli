import { existsSync, readFileSync } from 'node:fs';
import type { z } from 'zod';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export interface MergeOptions {
  /**
   * Dot-notation paths where arrays are concatenated rather than replaced.
   * e.g. ['execPermissions.approve'] means local values are appended to home values.
   */
  additivePaths?: string[];
}

export function mergeRawConfigs(home: Record<string, unknown>, local: Record<string, unknown>, options?: MergeOptions): Record<string, unknown> {
  const additive = new Set(options?.additivePaths ?? []);
  const merged: Record<string, unknown> = { ...home };

  for (const [key, value] of Object.entries(local)) {
    if (value === null) {
      delete merged[key];
    } else if (isPlainObject(value) && isPlainObject(merged[key])) {
      const mergedSub: Record<string, unknown> = { ...(merged[key] as Record<string, unknown>) };
      for (const [sk, sv] of Object.entries(value)) {
        if (sv === null) {
          delete mergedSub[sk];
        } else if (additive.has(`${key}.${sk}`) && Array.isArray(sv) && Array.isArray(mergedSub[sk])) {
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

export function loadConfig<T>(schema: z.ZodType<T>, homePath: string, localPath: string, mergeOptions?: MergeOptions): { config: T; warnings: string[]; paths: string[] } {
  const warnings: string[] = [];
  const paths: string[] = [];

  let homeRaw: Record<string, unknown> = {};
  if (existsSync(homePath)) {
    paths.push(homePath);
    homeRaw = readRaw(homePath, warnings);
  }

  let localRaw: Record<string, unknown> = {};
  if (existsSync(localPath)) {
    paths.push(localPath);
    localRaw = readRaw(localPath, warnings);
  }

  const merged = mergeRawConfigs(homeRaw, localRaw, mergeOptions);
  const config = schema.parse(merged);
  return { config, warnings, paths };
}

export function cleanSchema(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map((item) => cleanSchema(item));
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'maximum' && value === Number.MAX_SAFE_INTEGER) {
        continue;
      }
      result[key] = cleanSchema(value);
    }
    return result;
  }
  return obj;
}

export function generateJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const raw = (schema as z.ZodObject<z.ZodRawShape>).toJSONSchema({ target: 'draft-07', io: 'input' });
  return cleanSchema(raw) as Record<string, unknown>;
}
