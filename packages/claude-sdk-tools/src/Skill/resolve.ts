import { basename, dirname } from 'node:path';
import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import type { ILogger } from '@shellicar/claude-core/logging/ILogger';

export interface ResolvedSkill {
  /** The skill name — the directory holding the SKILL.md. */
  name: string;
  /** Absolute path to the resolved SKILL.md. */
  file: string;
}

/** Resolve skill names to files across the configured roots. A skill is a `<root>/<name>/SKILL.md`.
 *
 *  Precedence is defined: roots are walked in order and a later root overrides an earlier one on a
 *  name collision, so a single skill can be overlaid without forking the whole set. A configured root
 *  that does not exist resolves nothing rather than failing — an empty or absent root list is a valid,
 *  visibly bare state. Pass a logger to trace which roots produced which skills. */
export async function resolveSkills(fs: IFileSystem, roots: readonly string[], logger?: ILogger): Promise<Map<string, ResolvedSkill>> {
  const resolved = new Map<string, ResolvedSkill>();
  for (const root of roots) {
    let records: Awaited<ReturnType<IFileSystem['find']>>;
    try {
      records = await fs.find(root, { pattern: '^SKILL\\.md$', type: 'file', maxDepth: 2 });
    } catch (err) {
      logger?.debug('skill root not scannable, skipped', { root, error: err instanceof Error ? err.message : String(err) });
      continue;
    }
    logger?.debug('skill root scanned', { root, foundSkillMd: records.length });
    for (const record of [...records].sort((a, b) => a.path.localeCompare(b.path))) {
      const name = basename(dirname(record.path));
      resolved.set(name, { name, file: record.path });
    }
  }
  logger?.debug('skills resolved', { roots: roots.length, skills: resolved.size, names: [...resolved.keys()] });
  return resolved;
}
