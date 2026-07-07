import { TOOL_INPUT_KEYED_BY } from '@shellicar/claude-sdk';
import { z } from 'zod';

export const PipeStepSchema = z.object({
  tool: z.string().describe('Name of the composable tool to run at this step'),
  // A nested tool input: the SDK path-normaliser descends into it via the sibling `tool` name,
  // so a marked path in a step (Find's/Paths' path) is replaced in place before any consumer reads it.
  input: z
    .record(z.string(), z.unknown())
    .describe('The fields this tool needs — its own inputs only.')
    .meta({ [TOOL_INPUT_KEYED_BY]: 'tool' }),
});

export const PipeToolInputSchema = z.object({
  steps: z.array(PipeStepSchema).min(1).describe('The pipeline. The first step is a source (Find, Paths); the rest are stages (Read, Match, Head, Tail, Range).'),
});
