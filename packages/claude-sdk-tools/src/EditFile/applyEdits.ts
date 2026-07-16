import { resolveAfterLine } from './resolveAfterLine';
import type { ResolvedEditOperationType } from './types';

export function applyEdits(lines: string[], edits: ResolvedEditOperationType[]): string[] {
  const result = [...lines];
  const total = lines.length;

  for (const edit of edits) {
    if (edit.action === 'replace') {
      result.splice(edit.startLine - 1, edit.endLine - edit.startLine + 1, ...edit.content.split('\n'));
    } else if (edit.action === 'delete') {
      result.splice(edit.startLine - 1, edit.endLine - edit.startLine + 1);
    } else {
      result.splice(resolveAfterLine(edit.after_line, total), 0, ...edit.content.split('\n'));
    }
  }

  return result;
}
