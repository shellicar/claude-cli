import { ToolDefinition } from '@shellicar/claude-sdk';
import { createHash } from 'node:crypto';
import { openSync, fstatSync, readSync, ftruncateSync, writeSync, closeSync } from 'node:fs';
import { EditConfirmInputType, EditConfirmOutputType, EditOutputType } from './types';
import { EditConfirmInput, EditConfirmOutput, EditOutput } from './schema';


export const editConfirmTool: ToolDefinition<EditConfirmInputType, EditConfirmOutputType> = {
  name: 'edit_confirm',
  description: 'Apply a staged edit after reviewing the diff.',
  input_schema: EditConfirmInput,
  input_examples: [{
    patchId: '2b9cfd39-7f29-4911-8cb2-ef4454635e51',
  }],
  handler: ({ patchId }, store) => {
    const input = store.get(patchId);
    if (input == null) {
      throw new Error('edit_confirm requires a staged edit from the edit tool');
    }
    const chained = EditOutput.parse(input);
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
      return EditConfirmOutput.parse({ linesChanged });
    } finally {
      closeSync(fd);
    }
  },
};
