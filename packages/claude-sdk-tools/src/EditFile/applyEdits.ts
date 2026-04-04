import type { ResolvedEditOperationType } from './types';

export function applyEdits(lines: string[], edits: ResolvedEditOperationType[]): string[] {
  const sorted = [...edits].sort((a, b) => {
    const aLine = a.action === 'insert' ? a.after_line : a.startLine;
    const bLine = b.action === 'insert' ? b.after_line : b.startLine;
    return bLine - aLine;
  });

  const result = [...lines];

  for (const edit of sorted) {
    if (edit.action === 'replace') {
      result.splice(edit.startLine - 1, edit.endLine - edit.startLine + 1, ...edit.content.split('\n'));
    } else if (edit.action === 'delete') {
      result.splice(edit.startLine - 1, edit.endLine - edit.startLine + 1);
    } else {
      result.splice(edit.after_line, 0, ...edit.content.split('\n'));
    }
  }

  return result;
}
