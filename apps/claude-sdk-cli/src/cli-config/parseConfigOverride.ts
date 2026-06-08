/**
 * Parse the --config JSON string into a raw override layer.
 *
 * --config is treated exactly like a config file: the same permissive schema
 * validates it, with the same tolerance for unknown keys and bad values. There
 * is no strict gate. The only rejections are malformed JSON (JSON.parse throws)
 * and a non-object payload (the schema's top-level object check throws — the
 * schema has no top-level .catch(), so a string/number/array/null fails it,
 * while any real object passes).
 *
 * The raw parsed object is returned for merging — not the schema's output — so
 * a partial override does not inject defaults that would clobber file values.
 * Its keys are validated later, with the merged config, by the same schema.
 */
export function parseConfigOverride(json: string): Record<string, unknown> {
  throw new Error('not implemented');
}
