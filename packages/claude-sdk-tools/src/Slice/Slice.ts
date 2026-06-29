import { z } from 'zod';
import { defineComposable } from '../composable';
import { windowGrain } from '../window';

export const SliceModel = z.object({
  start: z.number().int().describe('0-based start; negative counts from the end'),
  end: z.number().int().optional().describe('0-based end (exclusive); negative counts from the end; omit for "to the end"'),
});

export const Slice = defineComposable({
  name: 'Slice',
  description: 'A 0-based half-open window of the stream (negative indices count from the end). Stage.',
  operation: 'read',
  model: SliceModel,
  input_examples: [{ start: 0, end: 5 }, { start: -5 }, { start: 50, end: 80 }],
  pipe: { in: 'any', out: 'same' },
  run: async ({ start, end, input }) => windowGrain(input, (xs) => xs.slice(start, end)),
});
