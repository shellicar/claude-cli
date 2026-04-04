import type { z } from 'zod';
import type { EditFileInputSchema, EditFileOperationSchema, EditFileOutputSchema, EditFileResolvedOperationSchema, PreviewEditInputSchema, PreviewEditOutputSchema } from './schema';

export type PreviewEditInputType = z.infer<typeof PreviewEditInputSchema>;
export type PreviewEditOutputType = z.infer<typeof PreviewEditOutputSchema>;
export type EditFileInputType = z.infer<typeof EditFileInputSchema>;
export type EditFileOutputType = z.infer<typeof EditFileOutputSchema>;
export type EditOperationType = z.infer<typeof EditFileOperationSchema>;
export type ResolvedEditOperationType = z.infer<typeof EditFileResolvedOperationSchema>;
