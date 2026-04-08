import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClaudeMdLoader } from '../src/ClaudeMdLoader.js';

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'claude-md-test-'));
}

function write(dir: string, relativePath: string, content: string): void {
  const full = join(dir, relativePath);
  mkdirSync(join(dir, relativePath, '..'), { recursive: true });
  writeFileSync(full, content, 'utf-8');
}

const INSTRUCTION_PREFIX =
  'Codebase and user instructions are shown below. Be sure to adhere to these instructions. ' +
  'IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.';

describe('ClaudeMdLoader', () => {
  it('returns null when no files exist', () => {
    const cwd = makeTmpDir();
    const home = makeTmpDir();
    const loader = new ClaudeMdLoader(cwd, home);
    expect(loader.getContent()).toBeNull();
  });

  it('loads the home file', () => {
    const cwd = makeTmpDir();
    const home = makeTmpDir();
    write(home, '.claude/CLAUDE.md', 'User instructions here.');

    const loader = new ClaudeMdLoader(cwd, home);
    const content = loader.getContent();

    expect(content).not.toBeNull();
    expect(content).toContain(INSTRUCTION_PREFIX);
    expect(content).toContain("user's private global instructions for all projects");
    expect(content).toContain('User instructions here.');
  });

  it('loads the project root CLAUDE.md', () => {
    const cwd = makeTmpDir();
    const home = makeTmpDir();
    write(cwd, 'CLAUDE.md', 'Project instructions here.');

    const loader = new ClaudeMdLoader(cwd, home);
    const content = loader.getContent();

    expect(content).toContain('project instructions');
    expect(content).toContain('Project instructions here.');
  });

  it('loads the project-scoped .claude/CLAUDE.md', () => {
    const cwd = makeTmpDir();
    const home = makeTmpDir();
    write(cwd, '.claude/CLAUDE.md', 'Scoped instructions here.');

    const loader = new ClaudeMdLoader(cwd, home);
    const content = loader.getContent();

    expect(content).toContain('project-scoped instructions');
    expect(content).toContain('Scoped instructions here.');
  });

  it('loads CLAUDE.local.md', () => {
    const cwd = makeTmpDir();
    const home = makeTmpDir();
    write(cwd, 'CLAUDE.local.md', 'Local machine instructions here.');

    const loader = new ClaudeMdLoader(cwd, home);
    const content = loader.getContent();

    expect(content).toContain('local machine instructions');
    expect(content).toContain('Local machine instructions here.');
  });

  it('loads all four files together, prefix appears once', () => {
    const cwd = makeTmpDir();
    const home = makeTmpDir();
    write(home, '.claude/CLAUDE.md', 'Home content.');
    write(cwd, 'CLAUDE.md', 'Root content.');
    write(cwd, '.claude/CLAUDE.md', 'Scoped content.');
    write(cwd, 'CLAUDE.local.md', 'Local content.');

    const loader = new ClaudeMdLoader(cwd, home);
    const content = loader.getContent()!;

    expect(content).toContain('Home content.');
    expect(content).toContain('Root content.');
    expect(content).toContain('Scoped content.');
    expect(content).toContain('Local content.');
    // Prefix appears exactly once, not repeated per file
    expect(content.split(INSTRUCTION_PREFIX).length - 1).toBe(1);
  });

  it('preserves load order: home, project root, project scoped, local', () => {
    const cwd = makeTmpDir();
    const home = makeTmpDir();
    write(home, '.claude/CLAUDE.md', 'SENTINEL_HOME');
    write(cwd, 'CLAUDE.md', 'SENTINEL_ROOT');
    write(cwd, '.claude/CLAUDE.md', 'SENTINEL_SCOPED');
    write(cwd, 'CLAUDE.local.md', 'SENTINEL_LOCAL');

    const loader = new ClaudeMdLoader(cwd, home);
    const content = loader.getContent()!;

    const posHome = content.indexOf('SENTINEL_HOME');
    const posRoot = content.indexOf('SENTINEL_ROOT');
    const posScoped = content.indexOf('SENTINEL_SCOPED');
    const posLocal = content.indexOf('SENTINEL_LOCAL');

    expect(posHome).toBeLessThan(posRoot);
    expect(posRoot).toBeLessThan(posScoped);
    expect(posScoped).toBeLessThan(posLocal);
  });

  it('skips empty files', () => {
    const cwd = makeTmpDir();
    const home = makeTmpDir();
    write(home, '.claude/CLAUDE.md', '   \n  ');
    write(cwd, 'CLAUDE.md', 'Real content.');

    const loader = new ClaudeMdLoader(cwd, home);
    const content = loader.getContent()!;

    // Only one section — empty home file excluded
    expect(content).toContain('Real content.');
    expect(content).not.toContain("user's private global instructions");
  });

  it('returns null when all files are empty', () => {
    const cwd = makeTmpDir();
    const home = makeTmpDir();
    write(home, '.claude/CLAUDE.md', '');
    write(cwd, 'CLAUDE.md', '   ');

    const loader = new ClaudeMdLoader(cwd, home);
    expect(loader.getContent()).toBeNull();
  });

  it('trims leading and trailing whitespace from file contents', () => {
    const cwd = makeTmpDir();
    const home = makeTmpDir();
    write(cwd, 'CLAUDE.md', '\n\n  Trimmed content.  \n\n');

    const loader = new ClaudeMdLoader(cwd, home);
    const content = loader.getContent()!;

    expect(content).toContain('Trimmed content.');
    expect(content).not.toContain('\n\n  Trimmed');
  });
});
