import { z } from 'zod';

// The composable pipe transport (PipeContent/PipeInput) was superseded by the typed streams in
// `stream.ts`. The one schema retained here is the explicit-file-list input the standard Delete
// tools (DeleteFile, DeleteDirectory) accept directly — those tools are out of this redesign's
// scope (Delete is a parked terminal), so their model-facing shape is left unchanged.

export const PipeFilesSchema = z.object({
  type: z.literal('files'),
  values: z.array(z.string()),
});

export type PipeFiles = z.infer<typeof PipeFilesSchema>;
