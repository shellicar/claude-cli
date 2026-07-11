import { resolve } from 'node:path';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { dependsOn } from '@shellicar/core-di-lite';
import { readIfPresent, wrapBlock } from './promptSource.js';

export type SystemPromptSources = {
  user: boolean;
  project: boolean;
  projectClaude: boolean;
  local: boolean;
};

const DEFAULT_SOURCES: SystemPromptSources = { user: true, project: true, projectClaude: true, local: true };

type SystemPromptFile = {
  path: string;
  source: keyof SystemPromptSources;
};

function systemPromptFiles(cwd: string, home: string): SystemPromptFile[] {
  return [
    { path: resolve(home, '.claude', 'SYSTEM.md'), source: 'user' },
    { path: resolve(cwd, 'SYSTEM.md'), source: 'project' },
    { path: resolve(cwd, '.claude', 'SYSTEM.md'), source: 'projectClaude' },
    { path: resolve(cwd, 'SYSTEM.local.md'), source: 'local' },
  ];
}

/**
 * Loads SYSTEM.md files from the four standard locations on demand. Each
 * present, non-empty file becomes its own ordered entry, wrapped in a
 * `<system-md>` tag with a `Contents of <path>:` header as the first inner
 * line, so the model can see where each block came from. SYSTEM.md sources
 * carry a path but no human label (unlike ClaudeMdLoader), so the header is
 * the path alone. Unlike ClaudeMdLoader, no instruction prefix is added:
 * these are the real system-prompt blocks, composed additively into the
 * API `system` param.
 *
 * Files are read fresh on every call, so a new session picks up current
 * contents without a watcher (resolution timing is the caller's policy).
 */
export class SystemPromptLoader {
  @dependsOn(IFileSystem) private readonly fs!: IFileSystem;

  /** Returns the non-empty SYSTEM.md contents in source order, filtered by `sources`. */
  public async getSections(sources: SystemPromptSources = DEFAULT_SOURCES): Promise<string[]> {
    const sections: string[] = [];
    for (const file of systemPromptFiles(this.fs.cwd(), this.fs.homedir())) {
      if (!sources[file.source]) {
        continue;
      }
      const content = await readIfPresent(this.fs, file.path);
      if (content != null) {
        sections.push(wrapBlock('system-md', `Contents of ${file.path}:`, content));
      }
    }
    return sections;
  }
}
