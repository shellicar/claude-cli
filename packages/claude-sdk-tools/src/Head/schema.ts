import { z } from 'zod';

// The pipe contract - what flows between tools
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

export const HeadInputSchema = z.object({
  count: z.number().int().min(1).default(10).describe('Number of lines to return from the start'),
  content: PipeContentSchema.optional().describe('Pipe input. Provided by composition layer, not needed for standalone use.'),
});

export const HeadOutputSchema = PipeContentSchema;

