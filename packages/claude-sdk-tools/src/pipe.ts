import { z } from 'zod';

// The pipe contract — what flows between tools

export const PipeFilesSchema = z.object({
  type: z.literal('files'),
  values: z.array(z.string()),
});

export const PipeContentSchema = z.object({
  type: z.literal('content'),
  values: z.array(z.string()),
  totalLines: z.number().int(),
  path: z.string().optional().describe('Source file path, present when piped from ReadFile'),
});

export const PipeInputSchema = z.discriminatedUnion('type', [PipeFilesSchema, PipeContentSchema]);

export type PipeFiles = z.infer<typeof PipeFilesSchema>;
export type PipeContent = z.infer<typeof PipeContentSchema>;
export type PipeInput = z.infer<typeof PipeInputSchema>;
