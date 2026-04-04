import { z } from 'zod';

export const DeleteResultSchema = z.object({
  path: z.string(),
  error: z.string().optional(),
});

export const DeleteOutputSchema = z.object({
  deleted: z.array(z.string()),
  errors: z.array(DeleteResultSchema),
  totalDeleted: z.number().int(),
  totalErrors: z.number().int(),
});

export type DeleteResult = z.infer<typeof DeleteResultSchema>;
export type DeleteOutput = z.infer<typeof DeleteOutputSchema>;

type ErrorMapper = (err: unknown) => string | undefined;

export async function deleteBatch(
  paths: string[],
  op: (path: string) => Promise<void>,
  mapError: ErrorMapper,
): Promise<DeleteOutput> {
  const deleted: string[] = [];
  const errors: DeleteResult[] = [];

  for (const path of paths) {
    try {
      await op(path);
      deleted.push(path);
    } catch (err) {
      const message = mapError(err);
      if (message !== undefined) {
        errors.push({ path, error: message });
      } else {
        throw err;
      }
    }
  }

  return { deleted, errors, totalDeleted: deleted.length, totalErrors: errors.length };
}
