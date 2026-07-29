import type { VarStore } from './execute.js';

/** `$NAME` / `${NAME}`, read from the run's variables. An unknown name is left exactly as written
 *  rather than blanked, so a literal `$` survives and a typo shows up as itself instead of
 *  silently becoming empty. */
function substitute(value: string, vars: VarStore): string {
  return value.replace(/\$\{(\w+)\}|\$(\w+)/g, (whole, braced: string | undefined, bare: string | undefined) => vars.get(braced ?? bare ?? '') ?? whole);
}

/** Resolves `$NAME` references in an input's string fields, including inside arrays of strings —
 *  `Program{ args: ['--file', '$OUT'] }` is the case this exists for, and a top-level-only pass
 *  would silently leave the literal there.
 *
 *  Deliberately dumb about which fields are "target" vs "content": that distinction belongs to
 *  each leaf's own schema, not to this generic engine. A leaf whose field could hold a
 *  `$NAME`-shaped literal is responsible for its own escaping; this function has no way to know
 *  which is which. */
export function resolveReferences(input: Record<string, unknown>, vars: VarStore): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string') {
      resolved[key] = substitute(value, vars);
      continue;
    }
    if (Array.isArray(value)) {
      resolved[key] = value.map((item) => (typeof item === 'string' ? substitute(item, vars) : item));
      continue;
    }
    resolved[key] = value;
  }
  return resolved;
}
