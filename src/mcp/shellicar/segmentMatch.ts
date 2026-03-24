import { escapeRegex } from './escapeRegex';

/** Match a path segment against a pattern segment with * wildcards (e.g. *.sh, test-*). */
export function segmentMatch(value: string, pattern: string): boolean {
  if (pattern === '*') {
    return true;
  }
  if (!pattern.includes('*')) {
    return value === pattern;
  }

  // Convert segment pattern to regex: * → .*, escape the rest
  const regex = new RegExp('^' + pattern.split('*').map(escapeRegex).join('.*') + '$');
  return regex.test(value);
}
