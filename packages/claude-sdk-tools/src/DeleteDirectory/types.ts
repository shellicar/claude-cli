import type { z } from 'zod';
import type { DeleteDirectoryInputSchema, DeleteDirectoryOutputSchema, DeleteDirectoryResultSchema } from './schema';

export type DeleteDirectoryInput = z.output<typeof DeleteDirectoryInputSchema>;
export type DeleteDirectoryOutput = z.infer<typeof DeleteDirectoryOutputSchema>;
export type DeleteDirectoryResult = z.infer<typeof DeleteDirectoryResultSchema>;
