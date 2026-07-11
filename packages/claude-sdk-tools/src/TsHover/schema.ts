import { z } from 'zod';
import { positionInputSchema } from '../typescript/positionInputSchema';

export const TsHoverInputSchema = positionInputSchema;

// tsserver returns no symbol at a non-symbol position, so hover info is nullable.
export const TsHoverOutputSchema = z
  .object({
    text: z.string(),
    documentation: z.string().optional(),
    kind: z.string(),
  })
  .nullable();
