import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import type { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { defineTool, ToolOperation } from '@shellicar/claude-sdk';
import { splitFrontmatter } from './frontmatter';
import { resolveSkills } from './resolve';
import { SkillInputSchema, SkillOutputSchema } from './schema';
import type { SkillOutput } from './types';

/** The Skill tool: load one skill's body from the configured roots at runtime, inside the agent loop.
 *
 *  Load-only by design. Discovery is not the tool's job: the available-skills catalogue is injected as
 *  context (see buildSkillCatalogue), a stable cached prefix the model reads to decide when to load. A
 *  `list` operation would fire an extra turn and land its result outside that cacheable prefix —
 *  strictly worse. So the CLI only resolves a name to its body and strips the frontmatter; which skills
 *  exist, and what is always-on, is the launcher's policy. Pass a logger to trace loads. */
export function createSkillTool(fs: IFileSystem, skillDirs: readonly string[], logger?: ILogger) {
  return defineTool({
    name: 'Skill',
    operation: ToolOperation.Read,
    description: "Load a skill's instructions into the conversation. Available skills are listed in the injected skills catalogue; invoke only names from that list, never guessed ones. When a skill matches the task, invoke it before responding.",
    input_schema: SkillInputSchema,
    output_schema: SkillOutputSchema,
    input_examples: [{ skill: 'git' }],
    handler: async (input) => {
      const resolved = await resolveSkills(fs, skillDirs, logger);
      const target = resolved.get(input.skill);
      if (target === undefined) {
        const available = [...resolved.keys()].sort((a, b) => a.localeCompare(b));
        logger?.info('Skill load: not found', { skill: input.skill, available });
        return { textContent: { found: false, skill: input.skill, available } satisfies SkillOutput };
      }
      // Return the body only, frontmatter stripped, with leading whitespace trimmed — the catalogue
      // already carried the frontmatter, so the model wants the instructions, not the metadata.
      const body = splitFrontmatter(await fs.readFile(target.file)).body.trimStart();
      logger?.info('Skill load', { skill: input.skill, file: target.file, chars: body.length });
      return { textContent: { found: true, skill: input.skill, body } satisfies SkillOutput };
    },
  });
}
