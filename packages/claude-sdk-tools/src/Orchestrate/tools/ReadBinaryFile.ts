import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { conditionImage } from '@shellicar/claude-core/image/conditionImage';
import type { SipsBridge } from '@shellicar/claude-core/image/SipsBridge';
import type { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { pathSchema } from '@shellicar/claude-sdk';
import type { Stream, ToolV2Result } from '@shellicar/orchestrate-core';
import { fromLines } from '@shellicar/orchestrate-core';
import { fileTypeFromBuffer } from 'file-type';
import { z } from 'zod';
import { isNodeError } from '../../isNodeError.js';
import { defineToolV2 } from '../defineToolV2.js';

const MAX_BINARY_BYTES = 32 * 1024 * 1024;
const IMAGE_BASE64_MAX_BYTES = 5 * 1024 * 1024; // Anthropic API per-image cap
const HEADER_BASE64_CHARS = 5600; // file-type needs up to ~4100 bytes for accurate detection

export const ReadBinaryFileModel = z.object({
  path: pathSchema.describe('Path to the file. Supports absolute, relative, ~ and $HOME.'),
});

/** The always-single-target binary reader V2's `Read` deliberately skips (a directory of PDFs/
 *  images piped through a batch reader would decode all of them into context at once \u2014 expensive
 *  and irreversible, so `Read` only ever handles text). Auto-detects PDF/image content from the
 *  file itself rather than trusting a caller-declared MIME type \u2014 once a tool's whole purpose is
 *  "read binary content", there's nothing left to disambiguate by declaring one up front; V1's
 *  `ReadFile` needed the declared/validated `mimeType` only because one tool had to tell text and
 *  binary apart.
 *
 *  `excludeFromStages`: its real output is a native attachment, not `Stream` \u2014 piping a
 *  PDF into another Orchestrate stage is meaningless, so it stays individually callable but is
 *  never offered as a pipe stage. */
export function createReadBinaryFileToolV2(fs: IFileSystem, sips: SipsBridge, logger: ILogger) {
  return defineToolV2({
    name: 'ReadBinaryFile',
    description: 'Read a single PDF or image file (png, jpeg, gif, webp) as a native document/image attachment. Never fed by a pipe \u2014 use Read for text files.',
    operation: 'fs.read',
    model: ReadBinaryFileModel,
    excludeFromStages: true,
    run: (input, _upstream, stderr): ToolV2Result => {
      let ok = true;
      let attachment: unknown | undefined;

      async function* run(): AsyncGenerator<string, void, unknown> {
        const filePath = input.path;

        let size: number;
        try {
          ({ size } = await fs.stat(filePath));
        } catch (err) {
          ok = false;
          stderr.push(isNodeError(err, 'ENOENT') ? `File not found: ${filePath}` : String(err));
          return;
        }

        if (size > MAX_BINARY_BYTES) {
          ok = false;
          stderr.push(`File is too large (${Math.round(size / (1024 * 1024))}MB, max ${MAX_BINARY_BYTES / (1024 * 1024)}MB).`);
          return;
        }

        let data: string;
        try {
          data = await fs.readFile(filePath, 'base64');
        } catch (err) {
          ok = false;
          stderr.push(isNodeError(err, 'ENOENT') ? `File not found: ${filePath}` : String(err));
          return;
        }

        const header = Buffer.from(data.slice(0, HEADER_BASE64_CHARS), 'base64');
        const type = await fileTypeFromBuffer(header);

        if (type?.mime === 'application/pdf') {
          attachment = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } };
          yield `${filePath} (application/pdf, ${Math.round(size / 1024)}KB)`;
          return;
        }

        if (type?.mime === 'image/jpeg' || type?.mime === 'image/png' || type?.mime === 'image/gif' || type?.mime === 'image/webp') {
          const conditioned = await conditionImage(Buffer.from(data, 'base64'), type.mime, sips, logger);
          const outData = conditioned.data.toString('base64');
          if (outData.length > IMAGE_BASE64_MAX_BYTES) {
            ok = false;
            stderr.push(`Image base64 payload too large (${Math.round(outData.length / 1024)}KB, max ${IMAGE_BASE64_MAX_BYTES / 1024}KB).`);
            return;
          }
          attachment = { type: 'image', source: { type: 'base64', media_type: conditioned.mediaType, data: outData } };
          yield `${filePath} (${conditioned.mediaType}, ${Math.round(outData.length / 1024)}KB)`;
          return;
        }

        ok = false;
        stderr.push(`${filePath} is not a PDF or image \u2014 use Read for text files.`);
      }

      return { stdout: fromLines(run()), success: () => ok, attachments: () => (attachment ? [attachment] : []) };
    },
  });
}
