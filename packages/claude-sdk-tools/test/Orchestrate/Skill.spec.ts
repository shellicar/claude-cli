import { lines as toLines } from '@shellicar/orchestrate-core';
import { describe, expect, it } from 'vitest';
import { createSkillToolV2 } from '../../src/Orchestrate/tools/Skill.js';
import { MemoryFileSystem } from '../MemoryFileSystem.js';

async function drain(stream: AsyncIterable<unknown>): Promise<string[]> {
  const out: string[] = [];
  for await (const value of toLines(stream)) {
    out.push(String(value));
  }
  return out;
}

describe('Skill V2', () => {
  it('yields the frontmatter-stripped body of a found skill', async () => {
    const fs = new MemoryFileSystem({ '/skills/git/SKILL.md': '---\ndescription: git skill\n---\nUse git carefully.' });
    const tool = createSkillToolV2(fs, ['/skills']);

    const result = tool.run({ skill: 'git' }, undefined, []);
    const lines = await drain(result.stdout);

    expect(lines).toEqual(['Use git carefully.']);
    expect(result.success()).toBe(true);
  });

  it('lists available skill names when the requested one is not found', async () => {
    const fs = new MemoryFileSystem({ '/skills/git/SKILL.md': 'Use git carefully.' });
    const tool = createSkillToolV2(fs, ['/skills']);

    const result = tool.run({ skill: 'missing' }, undefined, []);
    const lines = await drain(result.stdout);

    expect(lines).toEqual(['Skill not found: missing', '- git']);
    expect(result.success()).toBe(false);
  });
});
