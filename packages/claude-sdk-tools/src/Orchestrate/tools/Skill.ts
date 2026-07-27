import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import type { ILogger } from '@shellicar/claude-core/logging/ILogger';
import type { Stream, ToolV2Result } from '@shellicar/orchestrate-core';
import { z } from 'zod';
import { splitFrontmatter } from '../../Skill/frontmatter.js';
import { resolveSkills } from '../../Skill/resolve.js';
import { defineToolV2 } from '../defineToolV2.js';

export const SkillToolV2Model = z.object({
  skill: z.string().min(1).describe('The name of a skill from the available-skills list.'),
});

/** The V2 tool equivalent of V1's `Skill` — same `resolveSkills`/`splitFrontmatter`, same
 *  load-only design (see V1's own doc comment: discovery is the launcher's catalogue, not this
 *  tool's job). `fs.read` tier: loading a skill body is a filesystem read like any other. */
export function createSkillToolV2(fs: IFileSystem, skillDirs: readonly string[], logger?: ILogger) {
  return defineToolV2({
    name: 'Skill',
    description: "Load a skill's instructions into the conversation. Available skills are listed in the injected skills catalogue; invoke only names from that list, never guessed ones. When a skill matches the task, invoke it before responding.",
    operation: 'fs.read',
    model: SkillToolV2Model,
    run: (input): ToolV2Result<string> => {
      let found = false;

      async function* run(): Stream<string> {
        const resolved = await resolveSkills(fs, skillDirs, logger);
        const target = resolved.get(input.skill);
        if (target === undefined) {
          const available = [...resolved.keys()].sort((a, b) => a.localeCompare(b));
          logger?.info('Skill load: not found', { skill: input.skill, available });
          yield `Skill not found: ${input.skill}`;
          for (const name of available) {
            yield `- ${name}`;
          }
          return;
        }
        found = true;
        const body = splitFrontmatter(await fs.readFile(target.file)).body.trimStart();
        logger?.info('Skill load', { skill: input.skill, file: target.file, chars: body.length });
        for (const line of body.split('\n')) {
          yield line;
        }
      }

      return { stdout: run(), success: () => found };
    },
  });
}
