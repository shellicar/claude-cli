import { resolve } from 'node:path';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { dependsOn } from '@shellicar/core-di-lite';
import { IRuntimeOptions } from './setup/IRuntimeOptions.js';

const INSTRUCTION_PREFIX = 'Codebase and user instructions are shown below. Be sure to adhere to these instructions. ' + 'IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.';

export type ClaudeMdSources = {
  user: boolean;
  project: boolean;
  projectClaude: boolean;
  local: boolean;
};

const DEFAULT_SOURCES: ClaudeMdSources = { user: true, project: true, projectClaude: true, local: true };

type ClaudeMdFile = {
  path: string;
  label: string;
  source: keyof ClaudeMdSources;
};

function claudeMdFiles(cwd: string, home: string): ClaudeMdFile[] {
  return [
    {
      path: resolve(home, '.claude', 'CLAUDE.md'),
      label: "user's private global instructions for all projects",
      source: 'user',
    },
    {
      path: resolve(cwd, 'CLAUDE.md'),
      label: 'project instructions',
      source: 'project',
    },
    {
      path: resolve(cwd, '.claude', 'CLAUDE.md'),
      label: 'project-scoped instructions',
      source: 'projectClaude',
    },
    {
      path: resolve(cwd, 'CLAUDE.local.md'),
      label: 'local machine instructions (not committed)',
      source: 'local',
    },
  ];
}

async function readIfPresent(fs: IFileSystem, path: string): Promise<string | null> {
  try {
    const content = (await fs.readFile(path)).trim();
    return content.length > 0 ? content : null;
  } catch {
    return null;
  }
}

/**
 * Loads CLAUDE.md files from standard locations on demand.
 * Call `getContent()` each time you need the content — files are read fresh
 * on every call, so the read never needs a watcher. Note that once the content
 * is injected into a conversation's first message it is pinned there for cache
 * stability; a mid-session edit changes the read but not what the model sees
 * until a fresh conversation.
 */
export class ClaudeMdLoader {
  @dependsOn(IFileSystem) private readonly fs!: IFileSystem;
  @dependsOn(IRuntimeOptions) private readonly runtime!: IRuntimeOptions;

  /** Reads all CLAUDE.md files and returns the formatted content, or null if none were found. */
  public async getContent(sources: ClaudeMdSources = DEFAULT_SOURCES): Promise<string | null> {
    const sections: string[] = [];

    for (const file of claudeMdFiles(this.fs.cwd(), this.fs.homedir())) {
      if (!sources[file.source]) {
        continue;
      }
      const content = await readIfPresent(this.fs, file.path);
      if (content != null) {
        sections.push(`<claude-md>\nContents of ${file.path} (${file.label}):\n\n${content}\n</claude-md>`);
      }
    }

    if (this.runtime.claudeMdFlagText != null) {
      sections.push(`<claude-md>\nContents of the --claudeMd launch flag:\n\n${this.runtime.claudeMdFlagText}\n</claude-md>`);
    }

    if (sections.length === 0) {
      return null;
    }

    return `${INSTRUCTION_PREFIX}\n\n${sections.join('\n\n')}`;
  }
}
