import { createHash } from 'node:crypto';
import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import type { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { parse as parseYaml } from 'yaml';
import { splitFrontmatter } from './frontmatter';
import { resolveSkills } from './resolve';

const HEADER = 'The following skills are available for use with the Skill tool:';

/** Read a skill's `description` from its frontmatter, trimmed, or undefined when absent/empty/unparseable. */
export function readDescription(frontmatter: string): string | undefined {
  if (frontmatter.length === 0) {
    return undefined;
  }
  try {
    const parsed = parseYaml(frontmatter) as unknown;
    if (parsed !== null && typeof parsed === 'object' && 'description' in parsed) {
      const value = (parsed as { description?: unknown }).description;
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }
  } catch {
    // Unparseable frontmatter → no description. The skill still appears by name; a broken frontmatter
    // must never drop a loadable skill from the catalogue.
  }
  return undefined;
}

/** Build the injected skills catalogue from the configured roots.
 *
 *  Mechanism, not policy: one line per resolvable skill, `- name` or `- name: description`, keyed by
 *  the directory name — the exact key the `Skill` tool's `load` resolves, so the list can never point
 *  at something `load` cannot find. `description` is read from the frontmatter (optional; a skill with
 *  none is listed by name). Returns null when nothing resolves, so the caller injects nothing. Pass a
 *  logger to trace the scan. */
export async function buildSkillCatalogue(fs: IFileSystem, skillDirs: readonly string[], logger?: ILogger): Promise<string | null> {
  const resolved = await resolveSkills(fs, skillDirs, logger);
  if (resolved.size === 0) {
    logger?.info('skill catalogue empty: no skills resolved from the configured roots', { roots: skillDirs });
    return null;
  }
  const entries = [...resolved.values()].sort((a, b) => a.name.localeCompare(b.name));
  const lines: string[] = [];
  for (const entry of entries) {
    let description: string | undefined;
    try {
      description = readDescription(splitFrontmatter(await fs.readFile(entry.file)).frontmatter);
    } catch (err) {
      logger?.debug('skill file unreadable; listing by name only', { name: entry.name, file: entry.file, error: err instanceof Error ? err.message : String(err) });
    }
    lines.push(description ? `- ${entry.name}: ${description}` : `- ${entry.name}`);
  }
  const catalogue = `${HEADER}\n\n${lines.join('\n')}`;
  logger?.info('skill catalogue built', { skills: entries.length, chars: catalogue.length });
  return catalogue;
}

/** One scanned skill: the catalogue line the model would see, and a content hash of its SKILL.md.
 *  The hash is over the whole file (frontmatter + body), so a body-only edit — invisible to `line` —
 *  still registers as a change. */
export type SkillEntry = { line: string; hash: string };

/** Scan the configured roots into a name→{line,hash} map — the raw material a delta tracker diffs across
 *  turns. Same resolution and line format as `buildSkillCatalogue` (directory-name key, optional
 *  `description`), plus a SHA-256 of the file's bytes so a content change is detectable even when the
 *  rendered line is unchanged. An unreadable file is listed by name with a hash of empty content. */
export async function scanSkillEntries(fs: IFileSystem, skillDirs: readonly string[], logger?: ILogger): Promise<Map<string, SkillEntry>> {
  const resolved = await resolveSkills(fs, skillDirs, logger);
  const entries = new Map<string, SkillEntry>();
  for (const entry of [...resolved.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    let content = '';
    try {
      content = await fs.readFile(entry.file);
    } catch (err) {
      logger?.debug('skill file unreadable during scan; listing by name only', { name: entry.name, file: entry.file, error: err instanceof Error ? err.message : String(err) });
    }
    const description = readDescription(splitFrontmatter(content).frontmatter);
    const line = description ? `- ${entry.name}: ${description}` : `- ${entry.name}`;
    const hash = createHash('sha256').update(content).digest('hex');
    entries.set(entry.name, { line, hash });
  }
  logger?.debug('skill entries scanned', { skills: entries.size });
  return entries;
}
