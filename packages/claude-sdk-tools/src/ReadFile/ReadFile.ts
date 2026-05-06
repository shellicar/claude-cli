import { expandPath } from '@shellicar/claude-core/fs/expandPath';
import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import type { ToolAttachmentBlock } from '@shellicar/claude-sdk';
import { defineTool } from '@shellicar/claude-sdk';
import { fileTypeFromBuffer } from 'file-type';
import { isNodeError } from '../isNodeError';
import { ReadFileInputSchema, ReadFileOutputSchema } from './schema';
import type { BinaryMimeType, InputMimeType, ReadFileOutput } from './types';

const MAX_BINARY_BYTES = 32 * 1024 * 1024;
const IMAGE_BASE64_MAX_BYTES = 5 * 1024 * 1024; // Anthropic API per-image cap

// file-type needs up to ~4100 bytes for accurate detection.
const HEADER_BASE64_CHARS = 5600;

type DetectResult = { kind: 'text'; lines: string[] } | { kind: 'binary'; mimeType: BinaryMimeType; block: ToolAttachmentBlock };

async function detectBlock(header: Buffer, data: string, inputMimeType: InputMimeType): Promise<DetectResult | null> {
  const type = await fileTypeFromBuffer(header);

  switch (type?.mime) {
    case undefined:
      if (inputMimeType !== 'text/plain') {
        return null;
      }
      return { kind: 'text', lines: Buffer.from(data, 'base64').toString('utf8').split('\n') };
    case 'application/pdf':
      if (inputMimeType !== 'application/pdf') {
        return null;
      }
      return { kind: 'binary', mimeType: 'application/pdf', block: { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } } };
    case 'image/jpeg':
    case 'image/png':
    case 'image/gif':
    case 'image/webp':
      if (inputMimeType !== 'image/*') {
        return null;
      }
      return { kind: 'binary', mimeType: type.mime, block: { type: 'image', source: { type: 'base64', media_type: type.mime, data } } };
    default:
      return null;
  }
}

export function createReadFile(fs: IFileSystem) {
  return defineTool({
    name: 'ReadFile',
    description: 'Read a text file. Returns all lines as structured content for piping into Head, Tail, Range or Grep.',
    operation: 'read',
    input_schema: ReadFileInputSchema,
    output_schema: ReadFileOutputSchema,
    input_examples: [{ path: '/path/to/file.ts' }, { path: '~/file.ts' }, { path: '$HOME/file.ts' }, { path: '/path/to/doc.pdf', mimeType: 'application/pdf' }, { path: '/path/to/image.png', mimeType: 'image/*' }],
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

      if (input.mimeType !== 'text/plain' && size > MAX_BINARY_BYTES) {
        const mb = Math.round(size / (1024 * 1024));
        return {
          textContent: {
            error: true,
            message: `File is too large (${mb}MB, max ${MAX_BINARY_BYTES / (1024 * 1024)}MB).`,
            path: filePath,
          } satisfies ReadFileOutput,
        };
      }

      // Read as base64 once and pass to detectBlock, which handles detection and content building.
      let data: string;
      try {
        data = await fs.readFile(filePath, 'base64');
      } catch (err) {
        if (isNodeError(err, 'ENOENT')) {
          return { textContent: { error: true, message: 'File not found', path: filePath } satisfies ReadFileOutput };
        }
        throw err;
      }

      const header = Buffer.from(data.slice(0, HEADER_BASE64_CHARS), 'base64');
      const result = await detectBlock(header, data, input.mimeType);

      if (!result) {
        return {
          textContent: {
            error: true,
            message: `File content does not match declared MIME type (${input.mimeType}).`,
            path: filePath,
          } satisfies ReadFileOutput,
        };
      }

      if (result.kind === 'binary' && result.mimeType.startsWith('image/')) {
        if (data.length > IMAGE_BASE64_MAX_BYTES) {
          const kb = Math.round(data.length / 1024);
          return {
            textContent: {
              error: true,
              message: `Image base64 payload too large (${kb}KB, max 5120KB).`,
              path: filePath,
            } satisfies ReadFileOutput,
          };
        }
      }

      if (result.kind === 'binary') {
        const sizeKb = Math.round(size / 1024);
        return {
          textContent: { type: 'binary', path: filePath, mimeType: result.mimeType, sizeKb } satisfies ReadFileOutput,
          attachments: [result.block],
        };
      }

      return {
        textContent: {
          type: 'content',
          values: result.lines,
          totalLines: result.lines.length,
          path: filePath,
        } satisfies ReadFileOutput,
      };
    },
  });
}
