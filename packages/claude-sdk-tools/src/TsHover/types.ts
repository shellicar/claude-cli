import type { z } from 'zod';
import type { TsHoverInputSchema } from './schema';

export type TsHoverInput = z.output<typeof TsHoverInputSchema>;
