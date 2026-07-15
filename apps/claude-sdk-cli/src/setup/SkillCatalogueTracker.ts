import path from 'node:path';
import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { expandPath } from '@shellicar/claude-core/fs/expandPath';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { scanSkillEntries } from '@shellicar/claude-sdk-tools/Skill';
import { dependsOn } from '@shellicar/core-di-lite';

const UPDATED_HEADER = 'The following skills have been updated:';
const REMOVED_HEADER = 'The following skills are no longer available:';

/**
 * Tracks the skill catalogue across queries and, when it changes, produces a delta reminder — the
 * persisted-leading `<system-reminder>` the CLI prepends to the next query's user message (see #2 in
 * the Skill feature). Its own concern, separate from DurableConfigFactory's one-shot full catalogue (#1).
 *
 * A "change" is a change to a skill's SKILL.md content bytes, detected by a SHA-256 held per skill name —
 * NOT a change to the rendered catalogue line. A body-only edit moves the hash but not the line, and the
 * model may have loaded that body earlier in the session, so re-surfacing the entry is the only signal the
 * loaded copy is now stale. mtime is not used: the file is re-read and hashed each scan, so a touch that
 * leaves the bytes unchanged produces no delta.
 *
 * No filesystem watcher: the delta is only ever consumed at query-assembly time, so re-scanning when the
 * query is built is behaviourally identical to watching, without the machinery. Mirrors ClaudeMdLoader,
 * which is re-read every turn with no watcher.
 *
 * The FIRST scan establishes the baseline and returns null (nothing to announce) — so a fresh or resumed
 * process is silent, and the model relies on the full catalogue (#1) already in context.
 */
export class SkillCatalogueTracker {
  @dependsOn(ConfigLoader) private readonly configLoader!: ConfigLoader<any>;
  @dependsOn(IFileSystem) private readonly fs!: IFileSystem;
  @dependsOn(ILogger) private readonly logger!: ILogger;

  #hashes: Map<string, string> | null = null;

  /** Re-scan the configured roots and return the delta reminder text, or null when nothing changed
   *  (including the first scan, which only records the baseline). */
  public async scanForDelta(): Promise<string | null> {
    const configured = this.configLoader.config.skillDirs;
    const dirs = configured.map((d: string) => path.resolve(this.fs.cwd(), expandPath(d, this.fs)));
    const entries = await scanSkillEntries(this.fs, dirs, this.logger);

    // First scan: record the baseline and announce nothing. Silent on a fresh or resumed process — the
    // full catalogue is already in context, and there is no prior state to diff against.
    if (this.#hashes == null) {
      this.#hashes = new Map([...entries].map(([name, e]) => [name, e.hash]));
      this.logger.info('skill catalogue baseline recorded', { skills: this.#hashes.size });
      return null;
    }

    const previous = this.#hashes;
    // Added or content-changed: the skill's current line, emitted even when byte-identical to before
    // (see the class doc — a body-only edit still warrants a reload nudge).
    const changedLines: string[] = [];
    for (const [name, entry] of entries) {
      if (previous.get(name) !== entry.hash) {
        changedLines.push(entry.line);
      }
    }
    const removed: string[] = [];
    for (const name of previous.keys()) {
      if (!entries.has(name)) {
        removed.push(name);
      }
    }

    this.#hashes = new Map([...entries].map(([name, e]) => [name, e.hash]));

    if (changedLines.length === 0 && removed.length === 0) {
      return null;
    }

    const parts: string[] = [];
    if (changedLines.length > 0) {
      parts.push(`${UPDATED_HEADER}\n\n${changedLines.sort().join('\n')}`);
    }
    if (removed.length > 0) {
      parts.push(
        `${REMOVED_HEADER}\n\n${removed
          .sort()
          .map((name) => `- ${name}`)
          .join('\n')}`,
      );
    }
    const delta = parts.join('\n\n');
    this.logger.info('skill catalogue delta', { changed: changedLines.length, removed: removed.length, chars: delta.length });
    return delta;
  }
}
