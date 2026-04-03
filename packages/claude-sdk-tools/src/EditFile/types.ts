import type { z } from 'zod';
import type { ConfirmEditFileInputSchema, ConfirmEditFileOutputSchema, EditInputSchema, EditFileOperationSchema, EditFileOutputSchema } from './schema';

export type EditInputType = z.infer<typeof EditInputSchema>;
export type EditOutputType = z.infer<typeof EditFileOutputSchema>;
export type EditConfirmInputType = z.infer<typeof ConfirmEditFileInputSchema>;
export type EditConfirmOutputType = z.infer<typeof ConfirmEditFileOutputSchema>;
export type EditOperationType = z.infer<typeof EditFileOperationSchema>;
