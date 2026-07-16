import { resolveAfterLine } from './resolveAfterLine';
import type { EditFileLineOperationType } from './types';

export function validateLineEdits(lines: string[], edits: EditFileLineOperationType[]): void {
  const total = lines.length;

  for (const edit of edits) {
    if (edit.action === 'insert') {
      resolveAfterLine(edit.after_line, total);
    } else {
      if (edit.startLine > total) {
        throw new Error(`${edit.action} startLine ${edit.startLine} out of bounds (file has ${total} lines)`);
      }
      if (edit.endLine > total) {
        throw new Error(`${edit.action} endLine ${edit.endLine} out of bounds (file has ${total} lines)`);
      }
      if (edit.startLine > edit.endLine) {
        throw new Error(`${edit.action} startLine ${edit.startLine} is greater than endLine ${edit.endLine}`);
      }
    }
  }

  // All line numbers refer to the same original file, so overlapping ranges
  // indicate conflicting edits that have no well-defined result.
  const ranges = edits.map((e) => ({
    start: e.action === 'insert' ? resolveAfterLine(e.after_line, total) : e.startLine,
    end: e.action === 'insert' ? resolveAfterLine(e.after_line, total) : e.endLine,
  }));

  for (let i = 0; i < ranges.length; i++) {
    for (let j = i + 1; j < ranges.length; j++) {
      const a = ranges[i];
      const b = ranges[j];
      if (a != null && b != null && a.start <= b.end && b.start <= a.end) {
        throw new Error(`line edits overlap: edit at ${a.start}\u2013${a.end} and edit at ${b.start}\u2013${b.end} target the same lines`);
      }
    }
  }
}
