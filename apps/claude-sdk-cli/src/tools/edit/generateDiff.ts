import { EditOperationType } from './types';


export function generateDiff(filePath: string, originalLines: string[], edits: EditOperationType[]): string {
  const sorted = [...edits].sort((a, b) => {
    const aLine = a.action === 'insert' ? a.after_line : a.startLine;
    const bLine = b.action === 'insert' ? b.after_line : b.startLine;
    return aLine - bLine;
  });

  const hunks: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`];

  for (const edit of sorted) {
    if (edit.action === 'replace') {
      const oldLines = originalLines.slice(edit.startLine - 1, edit.endLine);
      const newLines = edit.content.split('\n');
      hunks.push(`@@ -${edit.startLine},${oldLines.length} +${edit.startLine},${newLines.length} @@`);
      hunks.push(...oldLines.map(l => `-${l}`));
      hunks.push(...newLines.map(l => `+${l}`));
    } else if (edit.action === 'delete') {
      const oldLines = originalLines.slice(edit.startLine - 1, edit.endLine);
      hunks.push(`@@ -${edit.startLine},${oldLines.length} +${edit.startLine},0 @@`);
      hunks.push(...oldLines.map(l => `-${l}`));
    } else {
      const newLines = edit.content.split('\n');
      hunks.push(`@@ -${edit.after_line},0 +${edit.after_line + 1},${newLines.length} @@`);
      hunks.push(...newLines.map(l => `+${l}`));
    }
  }

  return hunks.join('\n');
}
