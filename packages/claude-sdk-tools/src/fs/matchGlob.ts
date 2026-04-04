export function matchGlob(pattern: string, name: string): boolean {
  // Strip leading **/ prefixes — directory traversal is handled by recursion
  const normalised = pattern.replace(/^(\*\*\/)+/, '');
  const escaped = normalised
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`).test(name);
}
