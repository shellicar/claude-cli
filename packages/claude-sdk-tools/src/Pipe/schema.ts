import { z } from 'zod';

export const PipeStepSchema = z.object({
  tool: z.string().describe('Name of the tool to invoke'),
  input: z.record(z.string(), z.unknown()).describe('Input for the tool. Do not include a content field — it is injected automatically from the previous step.'),
});

export const PipeToolInputSchema = z.object({
  steps: z.array(PipeStepSchema).min(1).describe('Sequence of tools to execute in order. The first step must be a source (Find or ReadFile). Subsequent steps are transformers (Grep, Head, Tail, Range). The content field is injected between steps automatically — do not include it in the step inputs.'),
});
