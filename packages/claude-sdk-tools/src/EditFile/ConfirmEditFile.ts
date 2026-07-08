import { createHash } from 'node:crypto';
import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { defineTool } from '@shellicar/claude-sdk';
import { EditFileInputSchema, EditFileOutputSchema } from './schema';
import type { PatchStore } from './types';

export function createEditFile(fs: IFileSystem, store: PatchStore) {
  return defineTool({
    name: 'EditFile',
    description: 'Apply a staged edit after reviewing the diff.',
    operation: 'write',
    input_schema: EditFileInputSchema,
    output_schema: EditFileOutputSchema,
    input_examples: [
      {
        patchId: '2b9cfd39-7f29-4911-8cb2-ef4454635e51',
        file: '/path/to/file.ts',
      },
    ],
    handler: async ({ patchId, file }) => {
      const chained = store.get(patchId);
      if (chained == null) {
        throw new Error('Staged preview not found. The patch store is in-memory — please run PreviewEdit again.');
      }
      // `file` arrives already expanded and chained.file was stored expanded, so compare directly.
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
      return { textContent: EditFileOutputSchema.parse({ linesAdded, linesRemoved }) };
    },
  });
}
