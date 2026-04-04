import { createHash, randomUUID } from 'node:crypto';
import { defineTool } from '@shellicar/claude-sdk';
import { expandPath } from '../expandPath';
import type { IFileSystem } from '../fs/IFileSystem';
import { applyEdits } from './applyEdits';
import { generateDiff } from './generateDiff';
import { EditFileOutputSchema, EditInputSchema } from './schema';
import { validateEdits } from './validateEdits';

export function createEditFile(fs: IFileSystem, store: Map<string, unknown>) {
  return defineTool({
    name: 'EditFile',
    description: 'Stage edits to a file. Returns a diff for review before confirming.',
    operation: 'read',
    input_schema: EditInputSchema,
    input_examples: [
      {
        file: '/path/to/file.ts',
        edits: [{ action: 'insert', after_line: 0, content: '// hello world' }],
      },
      {
        file: '/path/to/file.ts',
        edits: [{ action: 'replace', startLine: 5, endLine: 7, content: 'const x = 1;' }],
      },
      {
        file: '/path/to/file.ts',
        edits: [{ action: 'delete', startLine: 10, endLine: 12 }],
      },
      {
        file: '/path/to/file.ts',
        edits: [
          { action: 'delete', startLine: 3, endLine: 3 },
          { action: 'replace', startLine: 8, endLine: 9, content: 'export default foo;' },
        ],
      },
    ],
    handler: async (input) => {
      const filePath = expandPath(input.file, fs);
      const originalContent = await fs.readFile(filePath);
      const originalHash = createHash('sha256').update(originalContent).digest('hex');
      const originalLines = originalContent.split('\n');
      validateEdits(originalLines, input.edits);
      const newLines = applyEdits(originalLines, input.edits);
      const newContent = newLines.join('\n');
      const diff = generateDiff(filePath, originalLines, input.edits);
      const output = EditFileOutputSchema.parse({
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
