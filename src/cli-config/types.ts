import type { z } from 'zod';
import type { cliConfigSchema } from './schema';

export type ResolvedCliConfig = Omit<z.infer<typeof cliConfigSchema>, '$schema'>;
