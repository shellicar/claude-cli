import type { z } from 'zod';
import type { EditConfirmInputSchema, EditConfirmOutputSchema, EditInputSchema, EditOperationSchema, EditOutputSchema } from './schema';

export type EditInputType = z.infer<typeof EditInputSchema>;
export type EditOutputType = z.infer<typeof EditOutputSchema>;
export type EditConfirmInputType = z.infer<typeof EditConfirmInputSchema>;
export type EditConfirmOutputType = z.infer<typeof EditConfirmOutputSchema>;
export type EditOperationType = z.infer<typeof EditOperationSchema>;
