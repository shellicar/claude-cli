import { resolve } from 'node:path';
import type { IFileSystem } from '@shellicar/claude-sdk-tools/fs';

const INSTRUCTION_PREFIX = 'Codebase and user instructions are shown below. Be sure to adhere to these instructions. ' + 'IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.';

type ClaudeMdFile = {
  path: string;
  label: string;
};

function claudeMdFiles(cwd: string, home: string): ClaudeMdFile[] {
  return [
    {
      path: resolve(home, '.claude', 'CLAUDE.md'),
      label: "user's private global instructions for all projects",
    },
    {
      path: resolve(cwd, 'CLAUDE.md'),
      label: 'project instructions',
    },
    {
      path: resolve(cwd, '.claude', 'CLAUDE.md'),
      label: 'project-scoped instructions',
    },
    {
      path: resolve(cwd, 'CLAUDE.local.md'),
      label: 'local machine instructions (not committed)',
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
 * on every call, so changes are picked up without any watcher.
 */
export class ClaudeMdLoader {
  readonly #fs: IFileSystem;

  public constructor(fs: IFileSystem) {
    this.#fs = fs;
  }

  /** Reads all CLAUDE.md files and returns the formatted content, or null if none were found. */
  public async getContent(): Promise<string | null> {
    const sections: string[] = [];

    for (const file of claudeMdFiles(this.#fs.cwd(), this.#fs.homedir())) {
      const content = await readIfPresent(this.#fs, file.path);
      if (content != null) {
        sections.push(`Contents of ${file.path} (${file.label}):\n\n${content}`);
      }
    }

    if (sections.length === 0) {
      return null;
    }

    return `${INSTRUCTION_PREFIX}\n\n${sections.join('\n\n')}`;
  }
}
