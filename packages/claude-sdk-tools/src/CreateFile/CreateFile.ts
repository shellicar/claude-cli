import type { ToolDefinition } from '@shellicar/claude-sdk';
import type { IFileSystem } from '../fs/IFileSystem';
import { CreateFileInputSchema } from './schema';
import type { CreateFileOutput } from './types';

export function createCreateFile(fs: IFileSystem): ToolDefinition<typeof CreateFileInputSchema, CreateFileOutput> {
  return {
    name: 'CreateFile',
    description: 'Create a new file with optional content. Creates parent directories automatically. By default errors if the file already exists. Set overwrite: true to replace an existing file (errors if file does not exist).',
    operation: 'write',
    input_schema: CreateFileInputSchema,
    input_examples: [{ path: './src/NewFile.ts' }, { path: './src/NewFile.ts', content: 'export const foo = 1;\n' }, { path: './src/NewFile.ts', content: 'export const foo = 1;\n', overwrite: true }],
    handler: async (input): Promise<CreateFileOutput> => {
      const { overwrite = false, content = '' } = input;
      const exists = await fs.exists(input.path);

      if (!overwrite && exists) {
        return { error: true, message: 'File already exists. Set overwrite: true to replace it.', path: input.path };
      }
      if (overwrite && !exists) {
        return { error: true, message: 'File does not exist. Set overwrite: false to create it.', path: input.path };
      }

      await fs.writeFile(input.path, content);
      return { error: false, path: input.path };
    },
  };
}
