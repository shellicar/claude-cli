import type { ResolvedEditOperationType } from './types';

export function validateEdits(lines: string[], edits: ResolvedEditOperationType[]): void {

  const getLines = (edit: ResolvedEditOperationType) => {
    switch (edit.action) {
      case 'insert':
      case 'replace': {
        return edit.content.split('\n').length;
      }
      case 'delete': {
        return 0;
      }
    }

  };

  let currentLintCount = lines.length;

  for (const edit of edits) {
    const lines = getLines(edit);
      currentLintCount += lines;
    if (edit.action === 'insert') {
      if (edit.after_line > currentLintCount) {
        throw new Error(`insert after_line ${edit.after_line} out of bounds (file has ${currentLintCount} lines)`);
      }
    } else {
      if (edit.startLine > currentLintCount) {
        throw new Error(`${edit.action} startLine ${edit.startLine} out of bounds (file has ${currentLintCount} lines)`);
      }
      if (edit.endLine > currentLintCount) {
        throw new Error(`${edit.action} endLine ${edit.endLine} out of bounds (file has ${currentLintCount} lines)`);
      }
      if (edit.startLine > edit.endLine) {
        throw new Error(`${edit.action} startLine ${edit.startLine} is greater than endLine ${edit.endLine}`);
      }
      const removed = edit.endLine - edit.startLine + 1;
      currentLintCount -= removed;
    }
  }
}
