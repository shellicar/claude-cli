import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { createServiceCollection } from '@shellicar/core-di-lite';
import { describe, expect, it } from 'vitest';
import { SystemPromptLoader, type SystemPromptSources } from '../src/SystemPromptLoader.js';
import { MemoryFileSystem } from './MemoryFileSystem.js';

// SystemPromptLoader injects IFileSystem, so build it through a container.
function buildSystemPromptLoader(fs: IFileSystem): SystemPromptLoader {
  const services = createServiceCollection();
  services.register(IFileSystem).to(IFileSystem, () => fs);
  services.register(SystemPromptLoader).to(SystemPromptLoader);
  return services.buildProvider().resolve(SystemPromptLoader);
}

const HOME = '/home/user';
const CWD = '/project';

describe('SystemPromptLoader', () => {
  it('returns an empty array when no files exist', async () => {
    const fs = new MemoryFileSystem({}, HOME, CWD);
    const loader = buildSystemPromptLoader(fs);

    const expected: string[] = [];
    const actual = await loader.getSections();

    expect(actual).toEqual(expected);
  });

  it('returns the user file content as the only entry when only ~/.claude/SYSTEM.md exists', async () => {
    const fs = new MemoryFileSystem({ [`${HOME}/.claude/SYSTEM.md`]: 'User prompt.' }, HOME, CWD);
    const loader = buildSystemPromptLoader(fs);

    const expected = ['<system-md>\nUser prompt.\n</system-md>'];
    const actual = await loader.getSections();

    expect(actual).toEqual(expected);
  });

  it('returns the project file content when only ./SYSTEM.md exists', async () => {
    const fs = new MemoryFileSystem({ [`${CWD}/SYSTEM.md`]: 'Project prompt.' }, HOME, CWD);
    const loader = buildSystemPromptLoader(fs);

    const expected = ['<system-md>\nProject prompt.\n</system-md>'];
    const actual = await loader.getSections();

    expect(actual).toEqual(expected);
  });

  it('returns the projectClaude file content when only ./.claude/SYSTEM.md exists', async () => {
    const fs = new MemoryFileSystem({ [`${CWD}/.claude/SYSTEM.md`]: 'ProjectClaude prompt.' }, HOME, CWD);
    const loader = buildSystemPromptLoader(fs);

    const expected = ['<system-md>\nProjectClaude prompt.\n</system-md>'];
    const actual = await loader.getSections();

    expect(actual).toEqual(expected);
  });

  it('returns the local file content when only ./SYSTEM.local.md exists', async () => {
    const fs = new MemoryFileSystem({ [`${CWD}/SYSTEM.local.md`]: 'Local prompt.' }, HOME, CWD);
    const loader = buildSystemPromptLoader(fs);

    const expected = ['<system-md>\nLocal prompt.\n</system-md>'];
    const actual = await loader.getSections();

    expect(actual).toEqual(expected);
  });

  it('orders entries user, project, projectClaude, local', async () => {
    const fs = new MemoryFileSystem(
      {
        [`${HOME}/.claude/SYSTEM.md`]: 'U',
        [`${CWD}/SYSTEM.md`]: 'P',
        [`${CWD}/.claude/SYSTEM.md`]: 'PC',
        [`${CWD}/SYSTEM.local.md`]: 'L',
      },
      HOME,
      CWD,
    );
    const loader = buildSystemPromptLoader(fs);

    const expected = ['<system-md>\nU\n</system-md>', '<system-md>\nP\n</system-md>', '<system-md>\nPC\n</system-md>', '<system-md>\nL\n</system-md>'];
    const actual = await loader.getSections();

    expect(actual).toEqual(expected);
  });

  it('adds no instruction prefix', async () => {
    const fs = new MemoryFileSystem({ [`${CWD}/SYSTEM.md`]: 'Raw content.' }, HOME, CWD);
    const loader = buildSystemPromptLoader(fs);

    const expected = ['<system-md>\nRaw content.\n</system-md>'];
    const actual = await loader.getSections();

    expect(actual).toEqual(expected);
  });

  it('trims leading and trailing whitespace', async () => {
    const fs = new MemoryFileSystem({ [`${CWD}/SYSTEM.md`]: '  \n  Trimmed.  \n  ' }, HOME, CWD);
    const loader = buildSystemPromptLoader(fs);

    const expected = ['<system-md>\nTrimmed.\n</system-md>'];
    const actual = await loader.getSections();

    expect(actual).toEqual(expected);
  });

  it('skips empty files', async () => {
    const fs = new MemoryFileSystem(
      {
        [`${HOME}/.claude/SYSTEM.md`]: '',
        [`${CWD}/SYSTEM.md`]: 'Real content.',
      },
      HOME,
      CWD,
    );
    const loader = buildSystemPromptLoader(fs);

    const expected = ['<system-md>\nReal content.\n</system-md>'];
    const actual = await loader.getSections();

    expect(actual).toEqual(expected);
  });

  it('skips whitespace-only files', async () => {
    const fs = new MemoryFileSystem(
      {
        [`${HOME}/.claude/SYSTEM.md`]: '   \n  ',
        [`${CWD}/SYSTEM.md`]: 'Real content.',
      },
      HOME,
      CWD,
    );
    const loader = buildSystemPromptLoader(fs);

    const expected = ['<system-md>\nReal content.\n</system-md>'];
    const actual = await loader.getSections();

    expect(actual).toEqual(expected);
  });

  it('skips the user file when sources.user is false', async () => {
    const fs = new MemoryFileSystem(
      {
        [`${HOME}/.claude/SYSTEM.md`]: 'User.',
        [`${CWD}/SYSTEM.md`]: 'Project.',
      },
      HOME,
      CWD,
    );
    const loader = buildSystemPromptLoader(fs);
    const sources: SystemPromptSources = { user: false, project: true, projectClaude: true, local: true };

    const actual = await loader.getSections(sources);

    expect(actual).not.toContain('User.');
  });

  it('skips the project file when sources.project is false', async () => {
    const fs = new MemoryFileSystem(
      {
        [`${CWD}/SYSTEM.md`]: 'Project.',
        [`${CWD}/.claude/SYSTEM.md`]: 'ProjectClaude.',
      },
      HOME,
      CWD,
    );
    const loader = buildSystemPromptLoader(fs);
    const sources: SystemPromptSources = { user: true, project: false, projectClaude: true, local: true };

    const actual = await loader.getSections(sources);

    expect(actual).not.toContain('Project.');
  });

  it('skips the projectClaude file when sources.projectClaude is false', async () => {
    const fs = new MemoryFileSystem(
      {
        [`${CWD}/.claude/SYSTEM.md`]: 'ProjectClaude.',
        [`${CWD}/SYSTEM.local.md`]: 'Local.',
      },
      HOME,
      CWD,
    );
    const loader = buildSystemPromptLoader(fs);
    const sources: SystemPromptSources = { user: true, project: true, projectClaude: false, local: true };

    const actual = await loader.getSections(sources);

    expect(actual).not.toContain('ProjectClaude.');
  });

  it('skips the local file when sources.local is false', async () => {
    const fs = new MemoryFileSystem(
      {
        [`${CWD}/SYSTEM.md`]: 'Project.',
        [`${CWD}/SYSTEM.local.md`]: 'Local.',
      },
      HOME,
      CWD,
    );
    const loader = buildSystemPromptLoader(fs);
    const sources: SystemPromptSources = { user: true, project: true, projectClaude: true, local: false };

    const actual = await loader.getSections(sources);

    expect(actual).not.toContain('Local.');
  });

  it('returns an empty array when all sources are disabled', async () => {
    const fs = new MemoryFileSystem(
      {
        [`${HOME}/.claude/SYSTEM.md`]: 'User.',
        [`${CWD}/SYSTEM.md`]: 'Project.',
        [`${CWD}/.claude/SYSTEM.md`]: 'ProjectClaude.',
        [`${CWD}/SYSTEM.local.md`]: 'Local.',
      },
      HOME,
      CWD,
    );
    const loader = buildSystemPromptLoader(fs);
    const sources: SystemPromptSources = { user: false, project: false, projectClaude: false, local: false };

    const expected: string[] = [];
    const actual = await loader.getSections(sources);

    expect(actual).toEqual(expected);
  });
});
