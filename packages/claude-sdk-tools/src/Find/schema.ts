import { z } from 'zod';
import { PipeFilesSchema } from '../pipe';

export const FindOutputSuccessSchema = PipeFilesSchema;

export const FindOutputFailureSchema = z.object({
  error: z.literal(true),
  message: z.string(),
  path: z.string(),
});

export const FindOutputSchema = z.union([FindOutputSuccessSchema, FindOutputFailureSchema]);

export const FindInputSchema = z.object({
  path: z.string().describe('Directory to search. Supports absolute, relative, ~ and $HOME.'),
  pattern: z.string().optional().describe('Glob pattern to match filenames, e.g. *.ts, *.{ts,js}'),
  type: z.enum(['file', 'directory', 'both']).default('file').describe('Whether to find files, directories, or both'),
  exclude: z.array(z.string()).default(['dist', 'node_modules']).describe('Directory names to exclude from search'),
  maxDepth: z.number().int().min(1).optional().describe('Maximum directory depth to search'),
});
