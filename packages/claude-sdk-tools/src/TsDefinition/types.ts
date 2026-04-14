import type { z } from 'zod';
import type { TsDefinitionInputSchema } from './schema';

export type TsDefinitionInput = z.output<typeof TsDefinitionInputSchema>;
