import { pathSchema } from '@shellicar/claude-sdk';
import { z } from 'zod';

export const SupportedMimeTypeSchema = z.enum(['text/plain', 'application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp']);

// Excludes text/plain — a ReadFileBinarySuccess is never produced for text reads.
// After `if (mimeType === 'application/pdf')`, TypeScript narrows to the image
// union exactly, so BetaImageBlockParam.source.media_type needs no cast.
export const BinaryMimeTypeSchema = z.enum(['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp']);

export const InputMimeTypeSchema = z.enum(['text/plain', 'application/pdf', 'image/*']);

export const ReadFileInputSchema = z.object({
  path: pathSchema.describe('Path to the file. Supports absolute, relative, ~ and $HOME.'),
  mimeType: InputMimeTypeSchema.default('text/plain').describe('MIME type of the file content to read. Defaults to text/plain. ' + 'Use application/pdf for PDFs, image/* for images.'),
});

export const ReadFileBinarySuccessSchema = z.object({
  type: z.literal('binary'),
  path: z.string(),
  mimeType: BinaryMimeTypeSchema,
  sizeKb: z.number(),
});

// ReadFile is the non-pipe single-file read. A successful text read is rendered as plain
// text (path header line, then one `n:text` line per line \u2014 the same convention as
// Pipe's Read stage) rather than a JSON object, since a large file makes the JSON escaping
// and per-line array overhead balloon the output for no benefit to the reader.
export const ReadFileOutputSuccessSchema = z.string();

export const ReadFileOutputFailureSchema = z.object({
  error: z.literal(true),
  message: z.string(),
  path: z.string(),
});

export const ReadFileOutputSchema = z.union([ReadFileOutputSuccessSchema, ReadFileBinarySuccessSchema, ReadFileOutputFailureSchema]);
