import { z } from 'zod';

// The typed streams that flow between composable tools. Records are wide: every stage carries
// the full metadata and, post-Read, the lines. The projection trims only at the terminus (flatten).

export const FileTypeSchema = z.enum(['file', 'dir', 'link']);

/** One file record. `path` is the addressable value the downstream paths mission marks.
 *  `target` is present only for a symlink (the one-hop target, ls -l style). `size` is bytes;
 *  absent for a directory. */
export const FileRecordSchema = z.object({
  path: z.string(),
  type: FileTypeSchema,
  size: z.number().int().optional(),
  target: z.string().optional(),
});

export const ContentLineSchema = z.object({
  n: z.number().int(), // original 1-based line number in its own file
  text: z.string(),
});

/** A file with its lines — grouped, path on the file, never on the line. Carries the same
 *  metadata as a FileRecord (wide record) plus the lines. */
export const ContentRecordSchema = FileRecordSchema.extend({
  lines: z.array(ContentLineSchema),
});

export const FilesStreamSchema = z.object({ kind: z.literal('files'), files: z.array(FileRecordSchema) });
export const ContentStreamSchema = z.object({ kind: z.literal('content'), files: z.array(ContentRecordSchema) });

export const StreamSchema = z.discriminatedUnion('kind', [FilesStreamSchema, ContentStreamSchema]);

export type StreamKind = 'files' | 'content';
export type FileRecord = z.infer<typeof FileRecordSchema>;
export type ContentRecord = z.infer<typeof ContentRecordSchema>;
export type FilesStream = z.infer<typeof FilesStreamSchema>;
export type ContentStream = z.infer<typeof ContentStreamSchema>;
export type Stream = z.infer<typeof StreamSchema>;

// ---- the terminus flatten (the fixed projection) ----

/** '13K', '340B', or '' for a directory (size undefined). */
export function formatSize(size: number | undefined): string {
  if (size === undefined) {
    return '';
  }
  if (size < 1024) {
    return `${size}B`;
  }
  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)}K`;
  }
  return `${Math.round(size / (1024 * 1024))}M`;
}

/** Files → one record per line, ls -l style. dir → trailing '/'; link → 'name -> target'
 *  (target carries its own trailing '/' for a dir, applied in walk); plain file → no marker. */
export function flattenFiles(s: FilesStream): string {
  return s.files
    .map((f) => {
      const name = f.type === 'dir' ? `${f.path}/` : f.type === 'link' ? `${f.path} -> ${f.target}` : f.path;
      const size = formatSize(f.size);
      return size ? `${name}\t${size}` : name;
    })
    .join('\n');
}

/** Content → grouped by file: the path as a header line, then one `n:text` line per content line;
 *  a blank line between files. An empty content line is `n:` with nothing after. */
export function flattenContent(s: ContentStream): string {
  return s.files.map((f) => [f.path, ...f.lines.map((l) => `${l.n}:${l.text}`)].join('\n')).join('\n\n');
}
