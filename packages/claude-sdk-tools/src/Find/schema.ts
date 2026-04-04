import { z } from 'zod';

export const FindOutputSchema = z.object({
  paths: z.array(z.string()),
  totalCount: z.number().int(),
});

export const FindInputSchema = z.object({
  path: z.string().describe('Directory to search. Supports absolute, relative, ~ and $HOME.'),
  pattern: z.string().optional().describe('Glob pattern to match filenames, e.g. *.ts, *.{ts,js}'),
  type: z.enum(['file', 'directory', 'both']).default('file').describe('Whether to find files, directories, or both'),
  exclude: z.array(z.string()).default(['dist', 'node_modules']).describe('Directory names to exclude from search'),
  maxDepth: z.number().int().min(1).optional().describe('Maximum directory depth to search'),
});
