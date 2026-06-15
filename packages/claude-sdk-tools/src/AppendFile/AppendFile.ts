import { expandPath } from '@shellicar/claude-core/fs/expandPath';
import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { defineTool } from '@shellicar/claude-sdk';
import { AppendFileInputSchema, AppendFileOutputSchema } from './schema';

export function createAppendFile(fs: IFileSystem) {
  return defineTool({
    name: 'AppendFile',
    description: 'Appends text to the end of a file, creating the file (and any missing parent directories) if it does not exist. Content is written verbatim.',
    operation: 'write',
    input_schema: AppendFileInputSchema,
    output_schema: AppendFileOutputSchema,
    input_examples: [{ path: './log.txt', content: 'a line\n' }],
    handler: async (input) => {
      const filePath = expandPath(input.path, fs);
      await fs.appendFile(filePath, input.content);
      return { textContent: { error: false as const, path: filePath } };
    },
  });
}
