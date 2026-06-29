import { dirname, resolve } from 'node:path';
import type { z } from 'zod';
import { mergeRawConfigs } from '../config';
import { expandPath } from '../fs/expandPath';
import type { IFileSystem } from '../fs/interfaces';
import type { IConfigOptions } from './IConfigOptions';
import type { IConfigFileReader } from './interfaces';
import type { ConfigResult, ConfigSource } from './types';

/**
 * Read, merge, and schema-parse the config sources. Pure over its inputs: the
 * caller (a factory, eagerly at `buildProvider`) supplies the options, reader,
 * and filesystem. A file that fails JSON parsing contributes nothing and is
 * recorded as a warning, so a single broken edit does not abort the read. A
 * schema failure throws — which is what we want surfaced eagerly at boot for
 * the initial read, and what `ConfigReloader` catches to keep the previous
 * config on reload.
 */
export const readConfig = <T extends z.ZodType>(options: IConfigOptions<T>, reader: IConfigFileReader, fs: IFileSystem): ConfigResult<z.infer<T>> => {
  const { paths, mergeOptions, pathFields, overrides } = options;
  const sources: ConfigSource[] = [];
  const warnings: string[] = [];
  const raws: Record<string, unknown>[] = [];

  for (const path of paths) {
    if (!reader.exists(path)) {
      continue;
    }
    const text = reader.read(path);
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      if (pathFields !== undefined) {
        const sourceDir = dirname(path);
        for (const segments of pathFields) {
          resolvePathField(parsed, segments, (value) => resolve(sourceDir, expandPath(value, fs)));
        }
      }
      sources.push({ path, raw: parsed });
      raws.push(parsed);
    } catch {
      warnings.push(`Failed to parse ${path}`);
    }
  }

  const layers = [...raws];
  if (overrides !== undefined) {
    // Highest-precedence layer, recorded as a source so origin tracking
    // attributes overridden values to its label. Pushed last, so the
    // reverse walk over `sources` finds it first.
    sources.push({ path: overrides.origin, raw: overrides.raw });
    layers.push(overrides.raw);
  }

  const merged = layers.reduce<Record<string, unknown>>((acc, cur) => mergeRawConfigs(acc, cur, mergeOptions), {});
  const config = options.schema.parse(merged) as z.infer<T>;
  return { config, sources, warnings };
};

/**
 * Walk the `segments` into `obj`; if the leaf is a string, replace it with
 * `transform(leaf)`. Missing keys or non-object intermediate values
 * short-circuit silently — a declared path field that is absent from a
 * given source is not an error. An empty `segments` is a no-op.
 */
function resolvePathField(obj: Record<string, unknown>, segments: readonly string[], transform: (value: string) => string): void {
  if (segments.length === 0) {
    return;
  }
  let cursor: Record<string, unknown> = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const next = cursor[segments[i] as string];
    if (typeof next !== 'object' || next === null || Array.isArray(next)) {
      return;
    }
    cursor = next as Record<string, unknown>;
  }
  const leafKey = segments[segments.length - 1] as string;
  const leaf = cursor[leafKey];
  if (typeof leaf === 'string') {
    cursor[leafKey] = transform(leaf);
  }
}
