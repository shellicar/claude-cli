import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const INSTRUCTION_PREFIX =
  'Codebase and user instructions are shown below. Be sure to adhere to these instructions. ' +
  'IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.';

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

function readIfPresent(path: string): string | null {
  try {
    const content = readFileSync(path, 'utf-8').trim();
    return content.length > 0 ? content : null;
  } catch {
    return null;
  }
}

/**
 * Loads CLAUDE.md files from standard locations at startup.
 * Returns a single formatted string for use as a cachedReminder — injected once
 * into the first user message of a new conversation and cached for all subsequent turns.
 */
export class ClaudeMdLoader {
  readonly #content: string | null;

  public constructor(cwd: string = process.cwd(), home: string = homedir()) {
    this.#content = this.#load(cwd, home);
  }

  /** The formatted content ready to pass as a cachedReminders entry, or null if no files were found. */
  public getContent(): string | null {
    return this.#content;
  }

  #load(cwd: string, home: string): string | null {
    const sections: string[] = [];

    for (const file of claudeMdFiles(cwd, home)) {
      const content = readIfPresent(file.path);
      if (content != null) {
        sections.push(`Contents of ${file.path} (${file.label}):\n\n${content}`);
      }
    }

    if (sections.length === 0) return null;

    return `${INSTRUCTION_PREFIX}\n\n${sections.join('\n\n')}`;
  }
}
