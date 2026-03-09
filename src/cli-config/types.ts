import type { z } from 'zod';
import type { cliConfigSchema, thinkingEffortSchema } from './schema';

export type ResolvedCliConfig = Omit<z.infer<typeof cliConfigSchema>, '$schema'>;
export type ThinkingEffort = z.infer<typeof thinkingEffortSchema>;
