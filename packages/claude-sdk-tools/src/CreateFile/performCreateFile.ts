import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';

export type PerformCreateFileResult = { ok: true } | { ok: false; message: string };

/** The whole CreateFile operation \u2014 check existence against `overwrite`, then write \u2014 shared
 *  verbatim between V1 and V2. Each caller translates this neutral result into its own output
 *  shape (V1: a structured `{error, message, path}`; V2: `success()` + a stderr line). */
export async function performCreateFile(fs: IFileSystem, path: string, content: string, overwrite: boolean): Promise<PerformCreateFileResult> {
  const exists = await fs.exists(path);
  if (!overwrite && exists) {
    return { ok: false, message: 'File already exists. Set overwrite: true to replace it.' };
  }
  if (overwrite && !exists) {
    return { ok: false, message: 'File does not exist. Set overwrite: false to create it.' };
  }
  await fs.writeFile(path, content);
  return { ok: true };
}
