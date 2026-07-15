import { describe, expect, it } from 'vitest';
import { buildSkillCatalogue, scanSkillEntries } from '../src/Skill/catalogue';
import { splitFrontmatter } from '../src/Skill/frontmatter';
import { resolveSkills } from '../src/Skill/resolve';
import { createSkillTool } from '../src/Skill/Skill';
import { call } from './helpers';
import { MemoryFileSystem } from './MemoryFileSystem';

const gitSkill = ['---', 'description: Git as it works.', 'trigger: Before any git command.', '---', '', '# Git', '', 'The body.', ''].join('\n');
const plainSkill = ['# Voice', '', 'No frontmatter here.', ''].join('\n');
const blockScalarSkill = ['---', 'description: |', '  Testing methodology.', '  TRIGGER when writing tests.', '---', '', '# TDD', ''].join('\n');
const gitSkillEditedBody = ['---', 'description: Git as it works.', 'trigger: Before any git command.', '---', '', '# Git', '', 'The body, revised.', ''].join('\n');

function fsWith(files: Record<string, string>): MemoryFileSystem {
  return new MemoryFileSystem(files);
}

describe('splitFrontmatter', () => {
  it('returns the raw frontmatter text between the fences', () => {
    const expected = 'description: Git as it works.\ntrigger: Before any git command.';
    const actual = splitFrontmatter(gitSkill).frontmatter;
    expect(actual).toBe(expected);
  });

  it('returns the content after the fence as the body (leading blank line intact; load trims it)', () => {
    const expected = '\n# Git\n\nThe body.\n';
    const actual = splitFrontmatter(gitSkill).body;
    expect(actual).toBe(expected);
  });

  it('does not treat an inline --- inside a value as the closing fence', () => {
    const content = ['---', 'name: my-skill', 'description: the best --- skill ever', '---', '', '# Body', ''].join('\n');
    const expected = 'name: my-skill\ndescription: the best --- skill ever';
    const actual = splitFrontmatter(content).frontmatter;
    expect(actual).toBe(expected);
  });

  it('returns the body after the real closing fence despite an inline --- above it', () => {
    const content = ['---', 'description: the best --- skill ever', '---', '', '# Body', ''].join('\n');
    const expected = '\n# Body\n';
    const actual = splitFrontmatter(content).body;
    expect(actual).toBe(expected);
  });

  // A column-0 --- inside a quoted value is a YAML document-start marker, not valid string content, so
  // this input is not valid frontmatter. We still DEFINE the split: it fences at the first column-0 ---.
  it('splits at the first column-0 --- even one sitting inside a quoted value', () => {
    const content = ['---', 'description: "a', '---', 'b"', '---', '', '# Body', ''].join('\n');
    const expected = 'description: "a';
    const actual = splitFrontmatter(content).frontmatter;
    expect(actual).toBe(expected);
  });

  it('returns an empty frontmatter when there is no fence', () => {
    const expected = '';
    const actual = splitFrontmatter(plainSkill).frontmatter;
    expect(actual).toBe(expected);
  });

  it('returns the whole content as body when there is no fence', () => {
    const expected = plainSkill;
    const actual = splitFrontmatter(plainSkill).body;
    expect(actual).toBe(expected);
  });
});

describe('resolveSkills', () => {
  it('lets a later root override an earlier one on a name collision', async () => {
    const fs = fsWith({ '/roots/a/git/SKILL.md': gitSkill, '/roots/b/git/SKILL.md': plainSkill });
    const resolved = await resolveSkills(fs, ['/roots/a', '/roots/b']);
    const expected = '/roots/b/git/SKILL.md';
    const actual = resolved.get('git')?.file;
    expect(actual).toBe(expected);
  });

  it('skips a configured root that does not exist', async () => {
    const fs = fsWith({ '/roots/a/git/SKILL.md': gitSkill });
    const resolved = await resolveSkills(fs, ['/roots/missing', '/roots/a']);
    const expected = ['git'];
    const actual = [...resolved.keys()];
    expect(actual).toEqual(expected);
  });
});

describe('Skill tool', () => {
  it('loads a skill body by name, frontmatter stripped', async () => {
    const fs = fsWith({ '/roots/a/git/SKILL.md': gitSkill });
    const tool = createSkillTool(fs, ['/roots/a']);
    const expected = '# Git\n\nThe body.\n';
    const result = await call(tool, { skill: 'git' });
    const actual = result.found ? result.body : undefined;
    expect(actual).toBe(expected);
  });

  it('reports not found for an unknown skill name', async () => {
    const fs = fsWith({ '/roots/a/git/SKILL.md': gitSkill });
    const tool = createSkillTool(fs, ['/roots/a']);
    const expected = false;
    const result = await call(tool, { skill: 'nope' });
    const actual = result.found;
    expect(actual).toBe(expected);
  });

  it('lists the available skill names when a name is unknown', async () => {
    const fs = fsWith({ '/roots/a/git/SKILL.md': gitSkill, '/roots/a/voice/SKILL.md': plainSkill });
    const tool = createSkillTool(fs, ['/roots/a']);
    const expected = ['git', 'voice'];
    const result = await call(tool, { skill: 'nope' });
    const actual = result.found ? undefined : result.available;
    expect(actual).toEqual(expected);
  });
});

describe('scanSkillEntries', () => {
  it('renders the same line as the catalogue for a described skill', async () => {
    const fs = fsWith({ '/roots/a/git/SKILL.md': gitSkill });
    const actual = (await scanSkillEntries(fs, ['/roots/a'])).get('git')?.line;
    expect(actual).toBe('- git: Git as it works.');
  });

  it('lists a skill without a description by name only', async () => {
    const fs = fsWith({ '/roots/a/voice/SKILL.md': plainSkill });
    const actual = (await scanSkillEntries(fs, ['/roots/a'])).get('voice')?.line;
    expect(actual).toBe('- voice');
  });

  it('produces the same hash for identical content across scans', async () => {
    const fs = fsWith({ '/roots/a/git/SKILL.md': gitSkill });
    const first = (await scanSkillEntries(fs, ['/roots/a'])).get('git')?.hash;
    const second = (await scanSkillEntries(fs, ['/roots/a'])).get('git')?.hash;
    expect(second).toBe(first);
  });

  it('changes the hash on a body-only edit even though the line is unchanged', async () => {
    const before = (await scanSkillEntries(fsWith({ '/roots/a/git/SKILL.md': gitSkill }), ['/roots/a'])).get('git');
    const after = (await scanSkillEntries(fsWith({ '/roots/a/git/SKILL.md': gitSkillEditedBody }), ['/roots/a'])).get('git');
    expect(after?.hash).not.toBe(before?.hash);
  });

  it('keeps the line identical on a body-only edit', async () => {
    const before = (await scanSkillEntries(fsWith({ '/roots/a/git/SKILL.md': gitSkill }), ['/roots/a'])).get('git');
    const after = (await scanSkillEntries(fsWith({ '/roots/a/git/SKILL.md': gitSkillEditedBody }), ['/roots/a'])).get('git');
    expect(after?.line).toBe(before?.line);
  });
});

describe('buildSkillCatalogue', () => {
  it('returns null when no roots are configured', async () => {
    const fs = fsWith({ '/roots/a/git/SKILL.md': gitSkill });
    const expected = null;
    const actual = await buildSkillCatalogue(fs, []);
    expect(actual).toBe(expected);
  });

  it('lists a skill with its frontmatter description', async () => {
    const fs = fsWith({ '/roots/a/git/SKILL.md': gitSkill });
    const expected = 'The following skills are available for use with the Skill tool:\n\n- git: Git as it works.';
    const actual = await buildSkillCatalogue(fs, ['/roots/a']);
    expect(actual).toBe(expected);
  });

  it('lists a skill with no frontmatter by name only', async () => {
    const fs = fsWith({ '/roots/a/voice/SKILL.md': plainSkill });
    const expected = 'The following skills are available for use with the Skill tool:\n\n- voice';
    const actual = await buildSkillCatalogue(fs, ['/roots/a']);
    expect(actual).toBe(expected);
  });

  it('preserves a multi-line block-scalar description', async () => {
    const fs = fsWith({ '/roots/a/tdd/SKILL.md': blockScalarSkill });
    const expected = 'The following skills are available for use with the Skill tool:\n\n- tdd: Testing methodology.\nTRIGGER when writing tests.';
    const actual = await buildSkillCatalogue(fs, ['/roots/a']);
    expect(actual).toBe(expected);
  });

  it('keeps an inline --- inside a description', async () => {
    const content = ['---', 'name: whatever', 'description: the best --- skill ever', '---', '', '# Body', ''].join('\n');
    const fs = fsWith({ '/roots/a/my-skill/SKILL.md': content });
    const expected = 'The following skills are available for use with the Skill tool:\n\n- my-skill: the best --- skill ever';
    const actual = await buildSkillCatalogue(fs, ['/roots/a']);
    expect(actual).toBe(expected);
  });

  it('preserves a --- inside an indented block-scalar description', async () => {
    const content = ['---', 'description: |', '  line a', '  ---', '  line b', '---', '', '# Body', ''].join('\n');
    const fs = fsWith({ '/roots/a/blk/SKILL.md': content });
    const expected = 'The following skills are available for use with the Skill tool:\n\n- blk: line a\n---\nline b';
    const actual = await buildSkillCatalogue(fs, ['/roots/a']);
    expect(actual).toBe(expected);
  });

  // Invalid frontmatter (unterminated quote, caused by a column-0 --- inside the value) must not crash
  // the catalogue: the yaml parse error is swallowed and the skill is listed by name only.
  it('lists by name only when the frontmatter is invalid YAML', async () => {
    const content = ['---', 'description: "a', '---', 'b"', '---', '', '# Body', ''].join('\n');
    const fs = fsWith({ '/roots/a/weird/SKILL.md': content });
    const expected = 'The following skills are available for use with the Skill tool:\n\n- weird';
    const actual = await buildSkillCatalogue(fs, ['/roots/a']);
    expect(actual).toBe(expected);
  });

  it('sorts entries by name', async () => {
    const fs = fsWith({ '/roots/a/voice/SKILL.md': plainSkill, '/roots/a/git/SKILL.md': gitSkill });
    const expected = 'The following skills are available for use with the Skill tool:\n\n- git: Git as it works.\n- voice';
    const actual = await buildSkillCatalogue(fs, ['/roots/a']);
    expect(actual).toBe(expected);
  });
});
