import type { EditConfirmInput, EditConfirmOutput, EditInput, EditOperation, EditOutput } from './schema';
import type { z } from 'zod';

export type EditInputType = z.infer<typeof EditInput>;
export type EditOutputType = z.infer<typeof EditOutput>;
export type EditConfirmInputType = z.infer<typeof EditConfirmInput>;
export type EditConfirmOutputType = z.infer<typeof EditConfirmOutput>;
export type EditOperationType = z.infer<typeof EditOperation>;
