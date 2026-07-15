import { z } from 'zod';

export const SkillInputSchema = z
  .object({
    skill: z.string().min(1).describe('The name of a skill from the available-skills list.'),
  })
  .strict();

export const SkillOutputSchema = z.discriminatedUnion('found', [z.object({ found: z.literal(true), skill: z.string(), body: z.string() }), z.object({ found: z.literal(false), skill: z.string(), available: z.array(z.string()) })]);
