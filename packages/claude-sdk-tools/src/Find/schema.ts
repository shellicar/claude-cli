import { z } from 'zod';

export const FindOutputSchema = z.object({
  paths: z.array(z.string()),
  totalCount: z.number().int(),
});

export const FindInputDefaults = {
  exclude: ['dist', 'node_modules'],
  type: 'file' as const,
};

export const FindInputTypeSchema = z.enum(['file', 'directory', 'both']).describe('Whether to find files, directories, or both').meta({ default: FindInputDefaults.type });

export const FindInputSchema = z.object({
  path: z.string().describe('Directory to search. Supports absolute, relative, ~ and $HOME.'),
  pattern: z.string().optional().describe('Glob pattern to match filenames, e.g. *.ts, *.{ts,js}'),
  type: FindInputTypeSchema.optional(),
  exclude: z.array(z.string()).optional().describe('Directory names to exclude from search').meta({ default: FindInputDefaults.exclude }),
  maxDepth: z.number().int().min(1).optional().describe('Maximum directory depth to search'),
});