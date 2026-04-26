import { describe, expect, it } from 'vitest';
import { ClaudeMdLoader, type ClaudeMdSources } from '../src/ClaudeMdLoader.js';
import { MemoryFileSystem } from './MemoryFileSystem.js';

const ALL_SOURCES: ClaudeMdSources = { user: true, project: true, projectClaude: true, local: true };

const CWD = '/project';
const HOME = '/home/user';

const INSTRUCTION_PREFIX = 'Codebase and user instructions are shown below. Be sure to adhere to these instructions. ' + 'IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.';

describe('ClaudeMdLoader', () => {
  it('returns null when no files exist', async () => {
    const fs = new MemoryFileSystem({}, HOME, CWD);
    const loader = new ClaudeMdLoader(fs);
    expect(await loader.getContent()).toBeNull();
  });

  it('loads the home file', async () => {
    const fs = new MemoryFileSystem({ [`${HOME}/.claude/CLAUDE.md`]: 'User instructions here.' }, HOME, CWD);
    const loader = new ClaudeMdLoader(fs);
    const content = await loader.getContent();

    expect(content).not.toBeNull();
    expect(content).toContain(INSTRUCTION_PREFIX);
    expect(content).toContain("user's private global instructions for all projects");
    expect(content).toContain('User instructions here.');
  });

  it('loads the project root CLAUDE.md', async () => {
    const fs = new MemoryFileSystem({ [`${CWD}/CLAUDE.md`]: 'Project instructions here.' }, HOME, CWD);
    const loader = new ClaudeMdLoader(fs);
    const content = await loader.getContent();

    expect(content).toContain('project instructions');
    expect(content).toContain('Project instructions here.');
  });

  it('loads the project-scoped .claude/CLAUDE.md', async () => {
    const fs = new MemoryFileSystem({ [`${CWD}/.claude/CLAUDE.md`]: 'Scoped instructions here.' }, HOME, CWD);
    const loader = new ClaudeMdLoader(fs);
    const content = await loader.getContent();

    expect(content).toContain('project-scoped instructions');
    expect(content).toContain('Scoped instructions here.');
  });

  it('loads CLAUDE.local.md', async () => {
    const fs = new MemoryFileSystem({ [`${CWD}/CLAUDE.local.md`]: 'Local machine instructions here.' }, HOME, CWD);
    const loader = new ClaudeMdLoader(fs);
    const content = await loader.getContent();

    expect(content).toContain('local machine instructions');
    expect(content).toContain('Local machine instructions here.');
  });

  it('loads all four files together, prefix appears once', async () => {
    const fs = new MemoryFileSystem(
      {
        [`${HOME}/.claude/CLAUDE.md`]: 'Home content.',
        [`${CWD}/CLAUDE.md`]: 'Root content.',
        [`${CWD}/.claude/CLAUDE.md`]: 'Scoped content.',
        [`${CWD}/CLAUDE.local.md`]: 'Local content.',
      },
      HOME,
      CWD,
    );
    const loader = new ClaudeMdLoader(fs);
    const content = (await loader.getContent()) ?? '';

    expect(content).toContain('Home content.');
    expect(content).toContain('Root content.');
    expect(content).toContain('Scoped content.');
    expect(content).toContain('Local content.');
    expect(content.split(INSTRUCTION_PREFIX).length - 1).toBe(1);
  });

  it('preserves load order: home, project root, project scoped, local', async () => {
    const fs = new MemoryFileSystem(
      {
        [`${HOME}/.claude/CLAUDE.md`]: 'SENTINEL_HOME',
        [`${CWD}/CLAUDE.md`]: 'SENTINEL_ROOT',
        [`${CWD}/.claude/CLAUDE.md`]: 'SENTINEL_SCOPED',
        [`${CWD}/CLAUDE.local.md`]: 'SENTINEL_LOCAL',
      },
      HOME,
      CWD,
    );
    const loader = new ClaudeMdLoader(fs);
    const content = (await loader.getContent()) ?? '';

    const posHome = content.indexOf('SENTINEL_HOME');
    const posRoot = content.indexOf('SENTINEL_ROOT');
    const posScoped = content.indexOf('SENTINEL_SCOPED');
    const posLocal = content.indexOf('SENTINEL_LOCAL');

    expect(posHome).toBeLessThan(posRoot);
    expect(posRoot).toBeLessThan(posScoped);
    expect(posScoped).toBeLessThan(posLocal);
  });

  it('skips empty files', async () => {
    const fs = new MemoryFileSystem(
      {
        [`${HOME}/.claude/CLAUDE.md`]: '   \n  ',
        [`${CWD}/CLAUDE.md`]: 'Real content.',
      },
      HOME,
      CWD,
    );
    const loader = new ClaudeMdLoader(fs);
    const content = (await loader.getContent()) ?? '';

    expect(content).toContain('Real content.');
    expect(content).not.toContain("user's private global instructions");
  });

  it('returns null when all files are empty', async () => {
    const fs = new MemoryFileSystem(
      {
        [`${HOME}/.claude/CLAUDE.md`]: '',
        [`${CWD}/CLAUDE.md`]: '   ',
      },
      HOME,
      CWD,
    );
    const loader = new ClaudeMdLoader(fs);
    expect(await loader.getContent()).toBeNull();
  });

  it('trims leading and trailing whitespace from file contents', async () => {
    const fs = new MemoryFileSystem({ [`${CWD}/CLAUDE.md`]: '\n\n  Trimmed content.  \n\n' }, HOME, CWD);
    const loader = new ClaudeMdLoader(fs);
    const content = (await loader.getContent()) ?? '';

    expect(content).toContain('Trimmed content.');
    expect(content).not.toContain('\n\n  Trimmed');
  });
});

describe('ClaudeMdLoader — sources', () => {
  it('skips user file when user source is disabled', async () => {
    const fs = new MemoryFileSystem(
      {
        [`${HOME}/.claude/CLAUDE.md`]: 'User content.',
        [`${CWD}/CLAUDE.md`]: 'Project content.',
      },
      HOME,
      CWD,
    );
    const loader = new ClaudeMdLoader(fs);
    const sources: ClaudeMdSources = { ...ALL_SOURCES, user: false };

    const actual = await loader.getContent(sources);

    expect(actual).not.toContain('User content.');
  });

  it('still loads other files when user source is disabled', async () => {
    const fs = new MemoryFileSystem(
      {
        [`${HOME}/.claude/CLAUDE.md`]: 'User content.',
        [`${CWD}/CLAUDE.md`]: 'Project content.',
      },
      HOME,
      CWD,
    );
    const loader = new ClaudeMdLoader(fs);
    const sources: ClaudeMdSources = { ...ALL_SOURCES, user: false };

    const actual = await loader.getContent(sources);

    expect(actual).toContain('Project content.');
  });

  it('skips project file when project source is disabled', async () => {
    const fs = new MemoryFileSystem(
      {
        [`${CWD}/CLAUDE.md`]: 'Project root content.',
        [`${CWD}/.claude/CLAUDE.md`]: 'Scoped content.',
      },
      HOME,
      CWD,
    );
    const loader = new ClaudeMdLoader(fs);
    const sources: ClaudeMdSources = { ...ALL_SOURCES, project: false };

    const actual = await loader.getContent(sources);

    expect(actual).not.toContain('Project root content.');
  });

  it('skips projectClaude file when projectClaude source is disabled', async () => {
    const fs = new MemoryFileSystem(
      {
        [`${CWD}/.claude/CLAUDE.md`]: 'Scoped content.',
        [`${CWD}/CLAUDE.local.md`]: 'Local content.',
      },
      HOME,
      CWD,
    );
    const loader = new ClaudeMdLoader(fs);
    const sources: ClaudeMdSources = { ...ALL_SOURCES, projectClaude: false };

    const actual = await loader.getContent(sources);

    expect(actual).not.toContain('Scoped content.');
  });

  it('skips local file when local source is disabled', async () => {
    const fs = new MemoryFileSystem(
      {
        [`${CWD}/CLAUDE.md`]: 'Project content.',
        [`${CWD}/CLAUDE.local.md`]: 'Local content.',
      },
      HOME,
      CWD,
    );
    const loader = new ClaudeMdLoader(fs);
    const sources: ClaudeMdSources = { ...ALL_SOURCES, local: false };

    const actual = await loader.getContent(sources);

    expect(actual).not.toContain('Local content.');
  });

  it('returns null when all sources are disabled', async () => {
    const fs = new MemoryFileSystem(
      {
        [`${HOME}/.claude/CLAUDE.md`]: 'User content.',
        [`${CWD}/CLAUDE.md`]: 'Project content.',
        [`${CWD}/.claude/CLAUDE.md`]: 'Scoped content.',
        [`${CWD}/CLAUDE.local.md`]: 'Local content.',
      },
      HOME,
      CWD,
    );
    const loader = new ClaudeMdLoader(fs);
    const sources: ClaudeMdSources = { user: false, project: false, projectClaude: false, local: false };

    const actual = await loader.getContent(sources);

    expect(actual).toBeNull();
  });
});
