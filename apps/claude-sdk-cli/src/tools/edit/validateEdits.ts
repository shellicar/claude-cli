import type { EditOperationType } from './types';

export function validateEdits(lines: string[], edits: EditOperationType[]): void {
  for (const edit of edits) {
    if (edit.action === 'insert') {
      if (edit.after_line > lines.length) {
        throw new Error(`insert after_line ${edit.after_line} out of bounds (file has ${lines.length} lines)`);
      }
    } else {
      if (edit.startLine > lines.length) {
        throw new Error(`${edit.action} startLine ${edit.startLine} out of bounds (file has ${lines.length} lines)`);
      }
      if (edit.endLine > lines.length) {
        throw new Error(`${edit.action} endLine ${edit.endLine} out of bounds (file has ${lines.length} lines)`);
      }
      if (edit.startLine > edit.endLine) {
        throw new Error(`${edit.action} startLine ${edit.startLine} is greater than endLine ${edit.endLine}`);
      }
    }
  }
}
