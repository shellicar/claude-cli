import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { dependsOn } from '@shellicar/core-di-lite';
import { ALL_PROMPT_SOURCES, loadPromptFiles, type PromptSources } from './promptFiles.js';
import { wrapBlock } from './promptSource.js';

export type SystemPromptSources = PromptSources;

/**
 * Loads SYSTEM.md files from the four standard locations on demand. Each present,
 * non-empty file becomes its own ordered entry, wrapped in a `<system-md>` tag
 * with a `Contents of <path>:` header as the first inner line, so the model can
 * see where each block came from. Shares its file-loading with ClaudeMdLoader via
 * `loadPromptFiles`; unlike CLAUDE.md, no instruction prefix or human label is
 * added — these are the real system-prompt blocks, composed additively into the
 * API `system` param.
 *
 * Files are read fresh on every call, so a new session picks up current contents
 * without a watcher (resolution timing is the caller's policy).
 */
export class SystemPromptLoader {
  @dependsOn(IFileSystem) private readonly fs!: IFileSystem;

  /** Returns the non-empty SYSTEM.md contents in source order, filtered by `sources`. */
  public async getSections(sources: SystemPromptSources = ALL_PROMPT_SOURCES): Promise<string[]> {
    const loaded = await loadPromptFiles(this.fs, 'SYSTEM', sources);
    return loaded.map((file) => wrapBlock('system-md', `Contents of ${file.path}:`, file.content));
  }
}
