import { z } from 'zod';
import { defineComposable } from '../composable';
import { windowGrain } from '../window';

export const TailModel = z.object({ count: z.number().int().min(1).default(10).describe('Number of items to return from the end') });

export const Tail = defineComposable({
  name: 'Tail',
  description: 'Last N of the stream — files, or lines per file. Stage.',
  operation: 'read',
  model: TailModel,
  input_examples: [{ count: 10 }, { count: 50 }],
  pipe: { in: 'any', out: 'same' },
  run: async ({ count, input }) => windowGrain(input, (xs) => xs.slice(-count)),
});
