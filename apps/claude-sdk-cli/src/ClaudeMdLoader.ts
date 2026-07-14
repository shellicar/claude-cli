import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { dependsOn } from '@shellicar/core-di-lite';
import { ALL_PROMPT_SOURCES, loadPromptFiles, type PromptSources } from './promptFiles.js';
import { wrapBlock } from './promptSource.js';
import { IRuntimeOptions } from './setup/IRuntimeOptions.js';

const INSTRUCTION_PREFIX = 'Codebase and user instructions are shown below. Be sure to adhere to these instructions. ' + 'IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.';

export type ClaudeMdSources = PromptSources;

const SOURCE_LABELS: Record<keyof PromptSources, string> = {
  user: "user's private global instructions for all projects",
  project: 'project instructions',
  projectClaude: 'project-scoped instructions',
  local: 'local machine instructions (not committed)',
};

/**
 * Loads CLAUDE.md files from standard locations on demand, labels each and wraps
 * them in a `<claude-md>` block behind the instruction prefix. Shares its
 * file-loading with SystemPromptLoader via `loadPromptFiles`; only the formatting
 * below is CLAUDE.md-specific. Call `getContent()` each time you need the content
 * — files are read fresh on every call, so the read never needs a watcher. Note
 * that once the content is injected into a conversation's first message it is
 * pinned there for cache stability; a mid-session edit changes the read but not
 * what the model sees until a fresh conversation.
 */
export class ClaudeMdLoader {
  @dependsOn(IFileSystem) private readonly fs!: IFileSystem;
  @dependsOn(IRuntimeOptions) private readonly runtime!: IRuntimeOptions;

  /** Reads all CLAUDE.md files and returns the formatted content, or null if none were found. */
  public async getContent(sources: ClaudeMdSources = ALL_PROMPT_SOURCES): Promise<string | null> {
    const sections: string[] = [];

    for (const file of await loadPromptFiles(this.fs, 'CLAUDE', sources)) {
      sections.push(wrapBlock('claude-md', `Contents of ${file.path} (${SOURCE_LABELS[file.source]}):`, file.content));
    }

    if (this.runtime.claudeMdFlagText != null) {
      sections.push(wrapBlock('claude-md', 'Contents of the --claudeMd launch flag:', this.runtime.claudeMdFlagText));
    }

    if (sections.length === 0) {
      return null;
    }

    return `${INSTRUCTION_PREFIX}\n\n${sections.join('\n\n')}`;
  }
}
