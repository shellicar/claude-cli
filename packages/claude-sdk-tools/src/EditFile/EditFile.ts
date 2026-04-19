import { createHash, randomUUID } from 'node:crypto';
import { relative, resolve, sep } from 'node:path';
import { defineTool } from '@shellicar/claude-sdk';
import { expandPath } from '../expandPath';
import type { IFileSystem } from '../fs/IFileSystem';
import { applyEdits } from './applyEdits';
import { generateDiff } from './generateDiff';
import { PreviewEditInputSchema, PreviewEditOutputSchema } from './schema';
import type { EditFileLineOperationType, EditFileTextOperationType, PreviewEditOutputType } from './types';
import { validateLineEdits } from './validateEdits';

/**
 * Convert an absolute file path to a display-friendly path relative to cwd
 * when it falls under the current working directory, otherwise return as-is.
 * This avoids the double-slash issue when passing absolute paths to
 * `createTwoFilesPatch` which prepends "a/" and "b/".
 */
function toDisplayPath(absolutePath: string): string {
  const cwd = process.cwd();
  const resolved = resolve(absolutePath);
  if (resolved === cwd || resolved.startsWith(cwd + sep)) {
    return relative(cwd, resolved);
  }
  return resolved;
}

function lineKey(edit: EditFileLineOperationType): number {
  return edit.action === 'insert' ? edit.after_line : edit.startLine;
}

function sortBottomToTop(edits: EditFileLineOperationType[]): EditFileLineOperationType[] {
  return [...edits].sort((a, b) => lineKey(b) - lineKey(a));
}

function applyTextEdits(content: string, edits: EditFileTextOperationType[]): string {
  let current = content;
  for (const edit of edits) {
    const pattern = edit.action === 'regex_text' ? edit.pattern : edit.oldString.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const display = edit.action === 'regex_text' ? `pattern "${edit.pattern}"` : `"${edit.oldString}"`;
    const matches = [...current.matchAll(new RegExp(pattern, 'g'))];
    if (matches.length === 0) {
      throw new Error(`${edit.action}: ${display} not found in file`);
    }
    if (matches.length > 1 && !edit.replaceMultiple) {
      throw new Error(`${edit.action}: ${display} matched ${matches.length} times \u2014 set replaceMultiple: true to replace all`);
    }
    // replace_text: use a replacer function so $ in the replacement is never interpreted
    // specially by String.prototype.replace (which treats $$ $& $1 etc. as special patterns).
    // regex_text keeps the string form so $1, $&, $$ etc. work as documented.
    const replacer = edit.action === 'replace_text' ? () => edit.replacement : edit.replacement;
    current = current.replace(new RegExp(pattern, edit.replaceMultiple ? 'g' : ''), replacer as string);
  }
  return current;
}

export function createPreviewEdit(fs: IFileSystem, store: Map<string, PreviewEditOutputType>) {
  return defineTool({
    name: 'PreviewEdit',
    description: 'Preview edits to a file. Returns a diff for review \u2014 does not write to disk.',
    operation: 'read',
    input_schema: PreviewEditInputSchema,
    input_examples: [
      {
        file: '/path/to/file.ts',
        lineEdits: [{ action: 'insert', after_line: 0, content: '// hello world' }],
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
      const filePath = expandPath(input.file, fs);

      let baseContent: string;
      let originalHash: string;
      if (input.previousPatchId != null) {
        const prev = store.get(input.previousPatchId);
        if (!prev) {
          throw new Error('Previous patch not found. The patch store is in-memory \u2014 please run PreviewEdit again.');
        }
        if (expandPath(prev.file, fs) !== filePath) {
          throw new Error(`File mismatch: previousPatchId is for "${prev.file}" but this edit targets "${filePath}"`);
        }
        baseContent = prev.newContent;
        originalHash = prev.originalHash;
      } else {
        baseContent = await fs.readFile(filePath);
        originalHash = createHash('sha256').update(baseContent).digest('hex');
      }

      const baseLines = baseContent.split('\n');
      const sorted = sortBottomToTop(input.lineEdits);
      validateLineEdits(baseLines, sorted);
      const afterLineEdits = applyEdits(baseLines, sorted);
      const newContent = applyTextEdits(afterLineEdits.join('\n'), input.textEdits);
      const diff = generateDiff(toDisplayPath(filePath), baseContent, newContent);
      const output = PreviewEditOutputSchema.parse({
        patchId: randomUUID(),
        diff,
        file: filePath,
        newContent,
        originalHash,
      });
      store.set(output.patchId, output);
      return output;
    },
  });
}
