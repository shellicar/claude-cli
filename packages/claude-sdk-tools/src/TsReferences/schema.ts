import { z } from 'zod';
import { positionInputSchema } from '../typescript/positionInputSchema';

export const TsReferencesInputSchema = positionInputSchema;

// References grouped by absolute file path, so the path isn't repeated on every entry.
export const TsReferencesOutputSchema = z.record(
  z.string(),
  z.array(
    z.object({
      line: z.number().int(),
      character: z.number().int(),
      text: z.string(),
    }),
  ),
);
