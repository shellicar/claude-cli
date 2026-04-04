import { z } from 'zod';

// The pipe contract — what flows between tools
export const LineSchema = z.object({
  n: z.number().int().describe('Line number'),
  text: z.string().describe('Line content'),
  file: z.string().optional().describe('Source file path, present when piped from Find'),
});

export const PipeContentSchema = z.object({
  lines: z.array(LineSchema),
  totalLines: z.number().int(),
  path: z.string().optional().describe('Source file path, present when piped from ReadFile'),
});

export type Line = z.infer<typeof LineSchema>;
export type PipeContent = z.infer<typeof PipeContentSchema>;
