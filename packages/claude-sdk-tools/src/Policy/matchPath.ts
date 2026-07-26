import { sep } from 'node:path';

/** Concern 3, isolated: a location glob (`$PWD`, `$HOME`, `~/`, a `/**` depth suffix, `*`),
 *  tested against one resolved path. Ported from tower/mvp's `bridge::permissions` matcher,
 *  with one correctness fix: bridge's own `starts_with` has no boundary check, so `$PWD`
 *  would wrongly match a sibling directory that merely shares its prefix as a string
 *  (`/repo` matching `/repo-other/file`) \u2014 fixed here the same way this codebase's own
 *  `isInsideCwd` (apps/claude-sdk-cli/src/permissions.ts) already guards it: the boundary
 *  must be the exact path or fall on a real separator. */
export function matchesPath(pattern: string, path: string, cwd: string, home: string): boolean {
  if (pattern === '*') {
    return true;
  }
  let expanded = pattern.replaceAll('$PWD', cwd).replaceAll('$HOME', home);
  if (expanded.startsWith('~/')) {
    expanded = `${home}/${expanded.slice(2)}`;
  } else if (expanded === '~') {
    expanded = home;
  }
  const base = expanded.endsWith('/**') ? expanded.slice(0, -3) : expanded;
  return path === base || path.startsWith(base + sep);
}
