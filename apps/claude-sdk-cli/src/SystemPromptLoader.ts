import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';

export type SystemPromptSources = {
  user: boolean;
  project: boolean;
  projectClaude: boolean;
  local: boolean;
};

/**
 * Loads SYSTEM.md files from the four standard locations on demand. Each
 * present, non-empty file becomes its own ordered entry. Unlike
 * ClaudeMdLoader, no instruction prefix or labels are added: these are the
 * real system-prompt blocks, composed additively into the API `system` param.
 *
 * Files are read fresh on every call, so a new session picks up current
 * contents without a watcher (resolution timing is the caller's policy).
 */
export class SystemPromptLoader {
  readonly #fs: IFileSystem;

  public constructor(fs: IFileSystem) {
    this.#fs = fs;
  }

  /** Returns the non-empty SYSTEM.md contents in source order, filtered by `sources`. */
  public async getSections(_sources?: SystemPromptSources): Promise<string[]> {
    throw new Error('not implemented');
  }
}
