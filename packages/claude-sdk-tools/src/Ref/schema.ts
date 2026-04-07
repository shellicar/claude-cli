import { z } from 'zod';

export const RefInputSchema = z.object({
  id: z.string().describe('The ref ID returned in a { ref, size, hint } token.'),
  start: z.number().int().min(0).default(0).describe('Start character offset (inclusive). Default 0.'),
  limit: z.number().int().min(1).max(20_000).default(10_000).describe('Maximum number of characters to return. Max 20000, default 10000. Use start+limit to page through large refs.'),
});
