import type { z } from 'zod';
import type { TsDiagnosticsInputSchema } from './schema';

export type TsDiagnosticsInput = z.output<typeof TsDiagnosticsInputSchema>;
