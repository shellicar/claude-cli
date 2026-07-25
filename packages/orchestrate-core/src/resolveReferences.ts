/** Resolves `$NAME` references against captured values, in every top-level string field of an
 *  input object. Deliberately dumb about which fields are "target" vs "content" — that
 *  distinction belongs to each leaf's own schema (a target field like a file path must never be
 *  dynamically resolved, per the design doc), not to this generic engine. A leaf whose target
 *  field could contain a `$NAME`-shaped literal is responsible for its own escaping; this
 *  function has no way to know which fields are which. */
export function resolveReferences(input: Record<string, unknown>, captures: ReadonlyMap<string, string>): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    resolved[key] = typeof value === 'string' ? value.replace(/\$(\w+)/g, (match, name: string) => captures.get(name) ?? match) : value;
  }
  return resolved;
}
