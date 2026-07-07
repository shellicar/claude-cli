import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { defineTool } from '@shellicar/claude-sdk';
import { CreateFileInputSchema, CreateFileOutputSchema } from './schema';

export function createCreateFile(fs: IFileSystem) {
  return defineTool({
    name: 'CreateFile',
    description: 'Create a new file with optional content. Creates parent directories automatically. By default errors if the file already exists. Set overwrite: true to replace an existing file (errors if file does not exist).',
    operation: 'write',
    input_schema: CreateFileInputSchema,
    output_schema: CreateFileOutputSchema,
    input_examples: [{ path: './src/NewFile.ts' }, { path: './src/NewFile.ts', content: 'export const foo = 1;\n' }, { path: './src/NewFile.ts', content: 'export const foo = 1;\n', overwrite: true }],
    handler: async (input) => {
      // input.path arrives already expanded — the SDK replaced the marked path in place upstream.
      const filePath = input.path;
      const { overwrite = false, content = '' } = input;
      const exists = await fs.exists(filePath);

      if (!overwrite && exists) {
        return { textContent: { error: true, message: 'File already exists. Set overwrite: true to replace it.', path: filePath } };
      }
      if (overwrite && !exists) {
        return { textContent: { error: true, message: 'File does not exist. Set overwrite: false to create it.', path: filePath } };
      }

      await fs.writeFile(filePath, content);
      return { textContent: { error: false as const, path: filePath } };
    },
  });
}
