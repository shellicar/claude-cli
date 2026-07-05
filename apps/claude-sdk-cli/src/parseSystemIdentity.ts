import { parse as parseYaml } from 'yaml';

/** The parsed identity file: the display `name` from frontmatter (null when absent/malformed) and the model-facing `body`. */
export type ParsedSystemIdentity = {
  name: string | null;
  body: string;
};

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Reads `name` from a parsed frontmatter block, or null when the block is not a map, has no `name`, or `name` is not a non-empty string. */
function nameFrom(frontmatter: string): string | null {
  let parsed: unknown;
  try {
    parsed = parseYaml(frontmatter);
  } catch {
    return null; // malformed YAML → status shows "unknown"
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const name = (parsed as Record<string, unknown>).name;
  return typeof name === 'string' && name.length > 0 ? name : null;
}

/**
 * Splits a skill-shaped identity file into its frontmatter `name` and its
 * markdown body. No frontmatter → the whole content is the body and name is
 * null. Frontmatter present but no `name` (or malformed) → name is null (status
 * shows "unknown"). The body is what the model receives; the frontmatter never is.
 */
export function parseSystemIdentity(raw: string): ParsedSystemIdentity {
  const match = FRONTMATTER.exec(raw);
  if (match === null) {
    return { name: null, body: raw.trim() };
  }
  return { name: nameFrom(match[1]), body: raw.slice(match[0].length).trim() };
}
