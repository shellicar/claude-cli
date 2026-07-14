import { resolve } from 'node:path';
import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';

/** The four standard locations a prompt file (CLAUDE.md, SYSTEM.md) is loaded from. */
export type PromptSources = {
  user: boolean;
  project: boolean;
  projectClaude: boolean;
  local: boolean;
};

export const ALL_PROMPT_SOURCES: PromptSources = { user: true, project: true, projectClaude: true, local: true };

/** A prompt file that was present on disk: its source slot, path, and trimmed content. */
export type LoadedPromptFile = {
  source: keyof PromptSources;
  path: string;
  content: string;
};

function promptFilePaths(baseName: string, cwd: string, home: string): { source: keyof PromptSources; path: string }[] {
  return [
    { source: 'user', path: resolve(home, '.claude', `${baseName}.md`) },
    { source: 'project', path: resolve(cwd, `${baseName}.md`) },
    { source: 'projectClaude', path: resolve(cwd, '.claude', `${baseName}.md`) },
    { source: 'local', path: resolve(cwd, `${baseName}.local.md`) },
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
 * The one loading mechanism shared by the CLAUDE.md and SYSTEM.md loaders:
 * resolve the four standard locations for `baseName` against the live cwd/home,
 * read each present, non-empty file (trimmed), and return them in source order,
 * filtered by `sources`. Files are read fresh on every call, so the load follows
 * a cwd change without a watcher. How the sections are labelled or joined is the
 * caller's concern, not the load's.
 */
export async function loadPromptFiles(fs: IFileSystem, baseName: string, sources: PromptSources): Promise<LoadedPromptFile[]> {
  const loaded: LoadedPromptFile[] = [];
  for (const file of promptFilePaths(baseName, fs.cwd(), fs.homedir())) {
    if (!sources[file.source]) {
      continue;
    }
    const content = await readIfPresent(fs, file.path);
    if (content != null) {
      loaded.push({ source: file.source, path: file.path, content });
    }
  }
  return loaded;
}
