import { expandPath } from '@shellicar/claude-core/fs/expandPath';
import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { defineTool } from '@shellicar/claude-sdk';
import type { ToolAttachmentBlock } from '@shellicar/claude-sdk';
import { isNodeError } from '../isNodeError';
import { ReadFileInputSchema, ReadFileOutputSchema } from './schema';
import type { ReadFileOutput } from './types';

const MAX_FILE_BYTES = 500_000;
const MAX_BINARY_BYTES = 32 * 1024 * 1024;

function validateMagicBytes(header: Buffer, mimeType: string): boolean {
  switch (mimeType) {
    case 'application/pdf':
      return header.length >= 5 && header.slice(0, 5).toString('ascii') === '%PDF-';
    case 'image/jpeg':
      return header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
    case 'image/png':
      return (
        header.length >= 4 &&
        header[0] === 0x89 &&
        header[1] === 0x50 &&
        header[2] === 0x4e &&
        header[3] === 0x47
      );
    case 'image/gif':
      return header.length >= 4 && header.slice(0, 4).toString('ascii').startsWith('GIF8');
    case 'image/webp':
      return (
        header.length >= 12 &&
        header.slice(0, 4).toString('ascii') === 'RIFF' &&
        header.slice(8, 12).toString('ascii') === 'WEBP'
      );
    default:
      return true;
  }
}

export function createReadFile(fs: IFileSystem) {
  return defineTool({
    name: 'ReadFile',
    description:
      'Read a text file. Returns all lines as structured content for piping into Head, Tail, Range or Grep.',
    operation: 'read',
    input_schema: ReadFileInputSchema,
    output_schema: ReadFileOutputSchema,
    input_examples: [
      { path: '/path/to/file.ts' },
      { path: '~/file.ts' },
      { path: '$HOME/file.ts' },
      { path: '/path/to/doc.pdf', mimeType: 'application/pdf' },
    ],
    handler: async (input) => {
      const filePath = expandPath(input.path, fs);

      let size: number;
      try {
        ({ size } = await fs.stat(filePath));
      } catch (err) {
        if (isNodeError(err, 'ENOENT')) {
          return { textContent: { error: true, message: 'File not found', path: filePath } satisfies ReadFileOutput };
        }
        throw err;
      }

      if (input.mimeType !== 'text/plain') {
        if (size > MAX_BINARY_BYTES) {
          const mb = Math.round(size / (1024 * 1024));
          return {
            textContent: {
              error: true,
              message: `File is too large (${mb}MB, max ${MAX_BINARY_BYTES / (1024 * 1024)}MB).`,
              path: filePath,
            } satisfies ReadFileOutput,
          };
        }

        let data: string;
        try {
          data = await fs.readFile(filePath, 'base64');
        } catch (err) {
          if (isNodeError(err, 'ENOENT')) {
            return { textContent: { error: true, message: 'File not found', path: filePath } satisfies ReadFileOutput };
          }
          throw err;
        }

        // Only the first 20 base64 chars (~15 binary bytes) are decoded —
        // enough for all magic byte patterns without allocating the full buffer.
        const header = Buffer.from(data.slice(0, 20), 'base64');
        if (!validateMagicBytes(header, input.mimeType)) {
          return {
            textContent: {
              error: true,
              message: `File content does not match declared MIME type (${input.mimeType}).`,
              path: filePath,
            } satisfies ReadFileOutput,
          };
        }

        const sizeKb = Math.round(size / 1024);
        const attachments: ToolAttachmentBlock[] = input.mimeType === 'application/pdf'
          ? [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }]
          : [{ type: 'image', source: { type: 'base64', media_type: input.mimeType, data } }];

        return {
          textContent: { type: 'binary', path: filePath, mimeType: input.mimeType, sizeKb } satisfies ReadFileOutput,
          attachments,
        };
      }

      if (size > MAX_FILE_BYTES) {
        const kb = Math.round(size / 1024);
        return {
          textContent: {
            error: true,
            message: `File is too large to read (${kb}KB, max ${MAX_FILE_BYTES / 1000}KB). Use Head/Tail/Range for specific lines, or Grep/SearchFiles to locate content.`,
            path: filePath,
          } satisfies ReadFileOutput,
        };
      }

      let text: string;
      try {
        text = await fs.readFile(filePath);
      } catch (err) {
        if (isNodeError(err, 'ENOENT')) {
          return { textContent: { error: true, message: 'File not found', path: filePath } satisfies ReadFileOutput };
        }
        throw err;
      }

      const allLines = text.split('\n');
      return {
        textContent: {
          type: 'content',
          values: allLines,
          totalLines: allLines.length,
          path: filePath,
        } satisfies ReadFileOutput,
      };
    },
  });
}