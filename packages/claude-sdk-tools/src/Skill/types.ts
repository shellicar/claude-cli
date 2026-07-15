import type { z } from 'zod';
import type { SkillInputSchema, SkillOutputSchema } from './schema';

export type SkillInput = z.output<typeof SkillInputSchema>;
export type SkillOutput = z.output<typeof SkillOutputSchema>;
