import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { defineTool } from '@shellicar/claude-sdk';
import { applyEdits } from './applyEdits';
import { generateDiff } from './generateDiff';
import { resolveAfterLine } from './resolveAfterLine';
import { EditFileInputSchema, EditFileOutputSchema } from './schema';
import type { EditFileLineOperationType, EditFileTextOperationType } from './types';
import { validateLineEdits } from './validateEdits';

function lineKey(lines: string[], edit: EditFileLineOperationType): number {
  return edit.action === 'insert' ? resolveAfterLine(edit.after_line, lines) : edit.startLine;
}

function sortBottomToTop(lines: string[], edits: EditFileLineOperationType[]): EditFileLineOperationType[] {
  return [...edits].sort((a, b) => lineKey(lines, b) - lineKey(lines, a));
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

function applyTextEdits(content: string, edits: EditFileTextOperationType[]): string {
  let current = content;
  edits.forEach((edit, index) => {
    current = edit.action === 'replace_text' ? applyReplaceText(current, edit, index) : applyRegexText(current, edit, index);
  });
  return current;
}

export function createEditFile(fs: IFileSystem) {
  return defineTool({
    name: 'EditFile',
    description: 'Edit a file: apply line and text edits, write the result to disk, and return a line-numbered diff.',
    operation: 'write',
    input_schema: EditFileInputSchema,
    output_schema: EditFileOutputSchema,
    input_examples: [
      {
        file: '/path/to/file.ts',
        lineEdits: [{ action: 'insert', after_line: 0, content: '// hello world' }],
      },
      {
        file: '/path/to/file.ts',
        lineEdits: [{ action: 'insert', after_line: -1, content: '// appended at the end' }],
      },
      {
        file: '/path/to/file.ts',
        lineEdits: [{ action: 'replace', startLine: 5, endLine: 7, content: 'const x = 1;' }],
      },
      {
        file: '/path/to/file.ts',
        lineEdits: [{ action: 'delete', startLine: 10, endLine: 12 }],
      },
      {
        file: '/path/to/file.ts',
        lineEdits: [
          { action: 'delete', startLine: 3, endLine: 3 },
          { action: 'replace', startLine: 8, endLine: 9, content: 'export default foo;' },
        ],
      },
      {
        file: '/path/to/file.ts',
        textEdits: [{ action: 'regex_text', pattern: 'import type \\{ (\\w+) \\}', replacement: 'import { $1 }' }],
      },
      {
        file: '/path/to/file.ts',
        textEdits: [{ action: 'replace_text', oldString: 'import type { MyClass }', replacement: 'import { MyClass }' }],
      },
      {
        file: '/path/to/file.ts',
        lineEdits: [{ action: 'insert', after_line: 34, content: '\nfunction helper() {}' }],
        textEdits: [{ action: 'replace_text', oldString: 'oldCall()', replacement: 'helper()' }],
      },
    ],
    handler: async (input) => {
      // input.file arrives already expanded — the SDK replaced the marked path in place upstream.
      const filePath = input.file;
      const baseContent = await fs.readFile(filePath);
      // ''.split('\n') yields [''] — one phantom line, not zero — which would make an empty
      // file resolve after_line against a 1-line file instead of a 0-line one.
      const baseLines = baseContent === '' ? [] : baseContent.split('\n');
      const sorted = sortBottomToTop(baseLines, input.lineEdits);
      validateLineEdits(baseLines, sorted);
      const afterLineEdits = applyEdits(baseLines, sorted);
      const newContent = applyTextEdits(afterLineEdits.join('\n'), input.textEdits);
      const diff = generateDiff(baseContent, newContent);
      await fs.writeFile(filePath, newContent);
      return { textContent: EditFileOutputSchema.parse(diff) };
    },
  });
}
