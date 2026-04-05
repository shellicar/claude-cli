import { z } from 'zod';

export const RefInputSchema = z.object({
  id: z.string().describe('The ref ID returned in a { ref, size, hint } token.'),
  start: z.number().int().min(0).optional().describe('Start character offset (inclusive). For string content only.'),
  end: z.number().int().min(1).optional().describe('End character offset (exclusive). For string content only.'),
});
