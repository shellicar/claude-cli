import { z } from 'zod';
import { PipeContentSchema } from '../pipe';

export const SupportedMimeTypeSchema = z.enum(['text/plain', 'application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp']);

// Excludes text/plain — a ReadFileBinarySuccess is never produced for text reads.
// After `if (mimeType === 'application/pdf')`, TypeScript narrows to the image
// union exactly, so BetaImageBlockParam.source.media_type needs no cast.
export const BinaryMimeTypeSchema = z.enum(['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp']);

export const ReadFileInputSchema = z.object({
  path: z.string().describe('Path to the file. Supports absolute, relative, ~ and $HOME.'),
  mimeType: SupportedMimeTypeSchema.default('text/plain').describe('MIME type of the file content to read. Defaults to text/plain. ' + 'Use application/pdf for PDFs, image/* for images.'),
});

export const ReadFileBinarySuccessSchema = z.object({
  type: z.literal('binary'),
  path: z.string(),
  mimeType: BinaryMimeTypeSchema,
  sizeKb: z.number(),
});

export const ReadFileOutputSuccessSchema = PipeContentSchema;

export const ReadFileOutputFailureSchema = z.object({
  error: z.literal(true),
  message: z.string(),
  path: z.string(),
});

export const ReadFileOutputSchema = z.union([ReadFileOutputSuccessSchema, ReadFileBinarySuccessSchema, ReadFileOutputFailureSchema]);
