import type { z } from 'zod';
import type { ConfirmEditFileInputSchema, ConfirmEditFileOutputSchema, EditFileOperationSchema, EditFileOutputSchema, EditFileResolvedOperationSchema, EditInputSchema } from './schema';

export type EditInputType = z.infer<typeof EditInputSchema>;
export type EditOutputType = z.infer<typeof EditFileOutputSchema>;
export type EditConfirmInputType = z.infer<typeof ConfirmEditFileInputSchema>;
export type EditConfirmOutputType = z.infer<typeof ConfirmEditFileOutputSchema>;
export type EditOperationType = z.infer<typeof EditFileOperationSchema>;
export type ResolvedEditOperationType = z.infer<typeof EditFileResolvedOperationSchema>;
