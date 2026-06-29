import { z } from 'zod';

export const PipeStepSchema = z.object({
  tool: z.string().describe('Name of the composable tool to run at this step'),
  input: z.record(z.string(), z.unknown()).describe('The fields this tool needs — its own inputs only.'),
});

export const PipeToolInputSchema = z.object({
  steps: z.array(PipeStepSchema).min(1).describe('The pipeline. The first step is a source (Find, Paths); the rest are stages (Read, Match, Head, Tail, Range).'),
});
