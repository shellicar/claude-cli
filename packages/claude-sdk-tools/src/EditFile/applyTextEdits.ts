import { resolveAfterLine } from './resolveAfterLine';
import type { EditFileLineOperationType, EditFileTextOperationType } from './types';

function lineKey(total: number, edit: EditFileLineOperationType): number {
  return edit.action === 'insert' ? resolveAfterLine(edit.after_line, total) : edit.startLine;
}

export function sortBottomToTop(total: number, edits: EditFileLineOperationType[]): EditFileLineOperationType[] {
  return [...edits].sort((a, b) => lineKey(total, b) - lineKey(total, a));
}

function countOccurrences(content: string, needle: string): number {
  return content.split(needle).length - 1;
}

function applyReplaceText(content: string, edit: Extract<EditFileTextOperationType, { action: 'replace_text' }>, index: number): string {
  const count = countOccurrences(content, edit.oldString);
  if (count === 0) {
    throw new Error(`textEdits[${index}] replace_text: "${edit.oldString}" not found in file`);
  }
  if (count > 1 && !edit.replaceMultiple) {
    throw new Error(`textEdits[${index}] replace_text: "${edit.oldString}" matched ${count} times \u2014 set replaceMultiple: true to replace all`);
  }
  if (edit.replaceMultiple) {
    return content.split(edit.oldString).join(edit.replacement);
  }
  const at = content.indexOf(edit.oldString);
  return content.slice(0, at) + edit.replacement + content.slice(at + edit.oldString.length);
}

function applyRegexText(content: string, edit: Extract<EditFileTextOperationType, { action: 'regex_text' }>, index: number): string {
  const matches = [...content.matchAll(new RegExp(edit.pattern, 'g'))];
  if (matches.length === 0) {
    throw new Error(`textEdits[${index}] regex_text: pattern "${edit.pattern}" not found in file`);
  }
  if (matches.length > 1 && !edit.replaceMultiple) {
    throw new Error(`textEdits[${index}] regex_text: pattern "${edit.pattern}" matched ${matches.length} times \u2014 set replaceMultiple: true to replace all`);
  }
  return content.replace(new RegExp(edit.pattern, edit.replaceMultiple ? 'g' : ''), edit.replacement);
}

export function applyTextEdits(content: string, edits: EditFileTextOperationType[]): string {
  let current = content;
  edits.forEach((edit, index) => {
    current = edit.action === 'replace_text' ? applyReplaceText(current, edit, index) : applyRegexText(current, edit, index);
  });
  return current;
}
