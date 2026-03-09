const STRIP_KEYS = new Set(['required', 'additionalProperties']);

export function cleanSchema(obj: unknown, isRoot = false): unknown {
  if (Array.isArray(obj)) {
    return obj.map((item) => cleanSchema(item));
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'maximum' && value === Number.MAX_SAFE_INTEGER) {
        continue;
      }
      if (isRoot && STRIP_KEYS.has(key)) {
        continue;
      }
      result[key] = cleanSchema(value);
    }
    return result;
  }
  return obj;
}
