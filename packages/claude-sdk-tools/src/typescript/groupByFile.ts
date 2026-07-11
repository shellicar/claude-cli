/**
 * Group tool output entries by their `file` field: the absolute path becomes the
 * record key and `file` is stripped from each entry, so the path isn't repeated on
 * every one. Shared by the TS tools whose output is grouped by file.
 */
export const groupByFile = <T extends { file: string }>(items: readonly T[]): Record<string, Omit<T, 'file'>[]> => {
  const grouped: Record<string, Omit<T, 'file'>[]> = {};
  for (const { file, ...entry } of items) {
    grouped[file] ??= [];
    grouped[file].push(entry);
  }
  return grouped;
};
