import { z } from 'zod';
import { defineComposable } from '../composable';
import { windowGrain } from '../window';

export const RangeModel = z.object({
  start: z.number().int().min(1).describe('1-based start position (inclusive)'),
  end: z.number().int().min(1).describe('1-based end position (inclusive)'),
});

export const Range = defineComposable({
  name: 'Range',
  description: 'A 1-based inclusive window of the stream — files, or lines per file. Stage.',
  operation: 'read',
  model: RangeModel,
  input_examples: [
    { start: 1, end: 50 },
    { start: 100, end: 200 },
  ],
  pipe: { in: 'any', out: 'same' },
  run: async ({ start, end, input }) => windowGrain(input, (xs) => xs.slice(start - 1, end)),
});
