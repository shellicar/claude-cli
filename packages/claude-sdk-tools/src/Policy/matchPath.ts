import { resolve, sep } from 'node:path';

/** Turns whatever a caller actually wrote — relative, `~/`-prefixed, or already absolute — into
 *  a real absolute path, purely for this one comparison. Never mutates anything the caller holds;
 *  the result is used here and discarded. `resolve(cwd, ...)` is a no-op for an input that's
 *  already absolute, so this is safe to apply unconditionally to both sides of a match. */
function resolvePath(path: string, cwd: string, home: string): string {
  const tilded = path === '~' ? home : path.startsWith('~/') ? `${home}/${path.slice(2)}` : path;
  return resolve(cwd, tilded);
}

/** Concern 3, isolated: a location glob (`$PWD`, `$HOME`, `~/`, a `/**` depth suffix, `*`),
 *  tested against one resolved path. Ported from tower/mvp's `bridge::permissions` matcher,
 *  with one correctness fix: bridge's own `starts_with` has no boundary check, so `$PWD`
 *  would wrongly match a sibling directory that merely shares its prefix as a string
 *  (`/repo` matching `/repo-other/file`) — fixed here the same way this codebase's own
 *  `isInsideCwd` (apps/claude-sdk-cli/src/permissions.ts) already guards it: the boundary
 *  must be the exact path or fall on a real separator.
 *
 *  Both `pattern` and `path` are resolved independently via `resolvePath` before comparing —
 *  neither side assumes the other already normalised anything upstream (V1's `isInsideCwd`
 *  relies on `ToolRegistry.normaliseInputPaths` having mutated the input first; V2 has no
 *  equivalent step, so a relative `path` here must resolve itself or it can never match a
 *  `$PWD`-scoped rule at all). */
export function matchesPath(pattern: string, path: string, cwd: string, home: string): boolean {
  if (pattern === '*') {
    return true;
  }
  const expanded = pattern.replaceAll('$PWD', cwd).replaceAll('$HOME', home);
  const base = resolvePath(expanded.endsWith('/**') ? expanded.slice(0, -3) : expanded, cwd, home);
  const resolvedPath = resolvePath(path, cwd, home);
  return resolvedPath === base || resolvedPath.startsWith(base + sep);
}
