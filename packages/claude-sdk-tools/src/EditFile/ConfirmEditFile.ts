import { createHash } from 'node:crypto';
import { defineTool } from '@shellicar/claude-sdk';
import type { IFileSystem } from '../fs/IFileSystem';
import { ConfirmEditFileInputSchema, ConfirmEditFileOutputSchema, EditFileOutputSchema } from './schema';

export function createConfirmEditFile(fs: IFileSystem, store: Map<string, unknown>) {
  return defineTool({
    name: 'ConfirmEditFile',
    description: 'Apply a staged edit after reviewing the diff.',
    operation: 'write',
    input_schema: ConfirmEditFileInputSchema,
    input_examples: [
      {
        patchId: '2b9cfd39-7f29-4911-8cb2-ef4454635e51',
        file: '/path/to/file.ts',
      },
    ],
    handler: async ({ patchId, file }) => {
      const input = store.get(patchId);
      if (input == null) {
        throw new Error('edit_confirm requires a staged edit from the edit tool');
      }
      const chained = EditFileOutputSchema.parse(input);
      if (file !== chained.file) {
        throw new Error(`File mismatch: input has "${file}" but patch is for "${chained.file}"`);
      }
      const currentContent = await fs.readFile(chained.file);
      const currentHash = createHash('sha256').update(currentContent).digest('hex');
      if (currentHash !== chained.originalHash) {
        throw new Error(`File ${chained.file} has been modified since the edit was staged`);
      }
      await fs.writeFile(chained.file, chained.newContent);
      const diffLines = chained.diff.split('\n');
      const linesAdded = diffLines.filter((l) => l.startsWith('+') && !l.startsWith('+++')).length;
      const linesRemoved = diffLines.filter((l) => l.startsWith('-') && !l.startsWith('---')).length;
      return ConfirmEditFileOutputSchema.parse({ linesAdded, linesRemoved });
    },
  });
}
