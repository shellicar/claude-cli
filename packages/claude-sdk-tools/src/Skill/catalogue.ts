import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import type { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { parse as parseYaml } from 'yaml';
import { splitFrontmatter } from './frontmatter';
import { resolveSkills } from './resolve';

const HEADER = 'The following skills are available for use with the Skill tool:';

function readDescription(frontmatter: string): string | undefined {
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
