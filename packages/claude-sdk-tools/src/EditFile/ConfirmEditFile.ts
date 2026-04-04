import { createHash } from 'node:crypto';
import { closeSync, fstatSync, ftruncateSync, openSync, readSync, writeSync } from 'node:fs';
import type { ToolDefinition } from '@shellicar/claude-sdk';
import { ConfirmEditFileInputSchema, ConfirmEditFileOutputSchema, EditFileOutputSchema } from './schema';
import type { EditConfirmOutputType } from './types';

export const ConfirmEditFile: ToolDefinition<typeof ConfirmEditFileInputSchema, EditConfirmOutputType> = {
  name: 'ConfirmEditFile',
  description: 'Apply a staged edit after reviewing the diff.',
  operation: 'write',
  input_schema: ConfirmEditFileInputSchema,
  input_examples: [
    {
      patchId: '2b9cfd39-7f29-4911-8cb2-ef4454635e51',
    },
  ],
  handler: async ({ patchId }, store) => {
    const input = store.get(patchId);
    if (input == null) {
      throw new Error('edit_confirm requires a staged edit from the edit tool');
    }
    const chained = EditFileOutputSchema.parse(input);
    const fd = openSync(chained.file, 'r+');
    try {
      const { size } = fstatSync(fd);
      const buffer = Buffer.alloc(size);
      readSync(fd, buffer, 0, size, 0);
      const currentContent = buffer.toString('utf-8');
      const currentHash = createHash('sha256').update(currentContent).digest('hex');
      if (currentHash !== chained.originalHash) {
        throw new Error(`File ${chained.file} has been modified since the edit was staged`);
      }
      const newBuffer = Buffer.from(chained.newContent, 'utf-8');
      ftruncateSync(fd, 0);
      writeSync(fd, newBuffer, 0, newBuffer.length, 0);
      const linesChanged = Math.abs(chained.newContent.split('\n').length - currentContent.split('\n').length);
      return ConfirmEditFileOutputSchema.parse({ linesChanged });
    } finally {
      closeSync(fd);
    }
  },
};
