import { resolve } from 'node:path';

/** Turns whatever a caller actually wrote — relative, `~/`-prefixed, or already absolute — into
 *  a real absolute path, purely for one comparison. Never mutates anything the caller holds. */
export function resolvePath(path: string, cwd: string, home: string): string {
  const tilded = path === '~' ? home : path.startsWith('~/') ? `${home}/${path.slice(2)}` : path;
  return resolve(cwd, tilded);
}

/**
 * A pattern reduced to its segments, with `$PWD`/`$HOME`/`~` already resolved and adjacent `**`
 * merged.
 *
 * The merge matters beyond tidiness: every `**` a matcher keeps is another place it can be forced
 * to reconsider, and two of them side by side describe exactly the same set of paths as one. A
 * pattern that says `**\/**` costs twice for nothing. Non-adjacent `**` are left alone — they are
 * separated by something that must match, so they say different things and cannot be merged.
 *
 * A trailing `/**` is kept as a segment rather than stripped: it means "this directory and
 * everything under it", and both matchers express that by letting a final `**` absorb the rest,
 * including nothing at all.
 */
export function compilePathPattern(pattern: string, cwd: string, home: string): string[] {
  const expanded = pattern.replaceAll('$PWD', cwd).replaceAll('$HOME', home);
  const absolute = resolvePathPreservingGlobs(expanded, cwd, home);
  const segments = absolute.split('/').filter((s) => s.length > 0);

  const merged: string[] = [];
  for (const segment of segments) {
    if (segment === '**' && merged[merged.length - 1] === '**') {
      continue;
    }
    merged.push(segment);
  }

  // A pattern naming a place and nothing else means that place and everything under it: `$PWD`
  // has always covered the files in the project, not the directory entry alone, and the shipped
  // default depends on it. Adding the `**` here keeps that meaning while letting the matchers
  // below know only one set of rules. A pattern that already globs says what it means and is left
  // exactly as written — `$PWD/*.env` is deliberately not `$PWD/*.env/**`.
  if (!merged.some((segment) => segment.includes('*'))) {
    merged.push('**');
  }
  return merged;
}

/** `resolve()` would mangle a `**` segment, so the glob tail is set aside, the concrete prefix is
 *  resolved, and the two are rejoined. */
function resolvePathPreservingGlobs(pattern: string, cwd: string, home: string): string {
  const firstGlob = pattern.search(/[*]/);
  if (firstGlob === -1) {
    return resolvePath(pattern, cwd, home);
  }
  const cut = pattern.lastIndexOf('/', firstGlob);
  const prefix = cut <= 0 ? pattern.slice(0, firstGlob) : pattern.slice(0, cut);
  const tail = cut <= 0 ? pattern.slice(firstGlob) : pattern.slice(cut + 1);
  return `${resolvePath(prefix === '' ? '.' : prefix, cwd, home)}/${tail}`;
}

/** The path being judged, as segments. */
export function pathSegments(path: string, cwd: string, home: string): string[] {
  return resolvePath(path, cwd, home)
    .split('/')
    .filter((s) => s.length > 0);
}
