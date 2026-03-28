const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function sanitiseLoneSurrogates(s: string): string {
  return s.replace(LONE_SURROGATE_RE, '\uFFFD');
}
