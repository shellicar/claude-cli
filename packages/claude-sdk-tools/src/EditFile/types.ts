import type { z } from 'zod';
import type { EditFileInputSchema, EditFileLineOperationSchema, EditFileOutputSchema, EditFileResolvedOperationSchema, EditFileTextOperationSchema } from './schema';

export type EditFileInputType = z.infer<typeof EditFileInputSchema>;
export type EditFileOutputType = z.infer<typeof EditFileOutputSchema>;
export type EditFileLineOperationType = z.infer<typeof EditFileLineOperationSchema>;
export type EditFileTextOperationType = z.infer<typeof EditFileTextOperationSchema>;
export type ResolvedEditOperationType = z.infer<typeof EditFileResolvedOperationSchema>;
