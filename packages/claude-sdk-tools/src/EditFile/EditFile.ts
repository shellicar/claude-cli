import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { defineTool } from '@shellicar/claude-sdk';
import { applyEdits } from './applyEdits';
import { applyTextEdits, sortBottomToTop } from './applyTextEdits';
import { generateDiff } from './generateDiff';
import { EditFileInputSchema, EditFileOutputSchema } from './schema';
import { validateLineEdits } from './validateEdits';

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
      const sorted = sortBottomToTop(baseLines.length, input.lineEdits);
      validateLineEdits(baseLines, sorted);
      const afterLineEdits = applyEdits(baseLines, sorted);
      const newContent = applyTextEdits(afterLineEdits.join('\n'), input.textEdits);
      const diff = generateDiff(baseContent, newContent);
      await fs.writeFile(filePath, newContent);
      return { textContent: EditFileOutputSchema.parse(diff) };
    },
  });
}
