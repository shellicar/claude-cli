import type { z } from 'zod';
import type { TsReferencesInputSchema } from './schema';

export type TsReferencesInput = z.output<typeof TsReferencesInputSchema>;
