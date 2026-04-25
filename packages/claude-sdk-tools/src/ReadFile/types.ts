import type { z } from 'zod';
import type {
  BinaryMimeTypeSchema,
  ReadFileBinarySuccessSchema,
  ReadFileInputSchema,
  ReadFileOutputFailureSchema,
  ReadFileOutputSchema,
  ReadFileOutputSuccessSchema,
  SupportedMimeTypeSchema,
} from './schema';

export type ReadFileInput = z.output<typeof ReadFileInputSchema>;
export type ReadFileOutput = z.infer<typeof ReadFileOutputSchema>;
export type ReadFileOutputSuccess = z.infer<typeof ReadFileOutputSuccessSchema>;
export type ReadFileOutputFailure = z.infer<typeof ReadFileOutputFailureSchema>;
export type ReadFileBinarySuccess = z.infer<typeof ReadFileBinarySuccessSchema>;
export type SupportedMimeType = z.infer<typeof SupportedMimeTypeSchema>;
export type BinaryMimeType = z.infer<typeof BinaryMimeTypeSchema>;