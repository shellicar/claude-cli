import { z } from 'zod';
import { defineComposable } from '../composable';
import { windowGrain } from '../window';

export const HeadModel = z.object({ count: z.number().int().min(1).default(10).describe('Number of items to return from the start') });

export const Head = defineComposable({
  name: 'Head',
  description: 'First N of the stream — files, or lines per file. Stage.',
  operation: 'read',
  model: HeadModel,
  input_examples: [{ count: 10 }, { count: 50 }],
  pipe: { in: 'any', out: 'same' },
  run: async ({ count, input }) => windowGrain(input, (xs) => xs.slice(0, count)),
});
