const SENSITIVE_KEYS = new Set(['authorization', 'x-api-key', 'api-key', 'api_key', 'apikey', 'password', 'secret', 'token']);

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

export const redact = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SENSITIVE_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : redact(v)]));
  }
  return value;
};
