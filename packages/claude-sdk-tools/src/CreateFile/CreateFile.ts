import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { defineTool } from '@shellicar/claude-sdk';
import { performCreateFile } from './performCreateFile';
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
      const result = await performCreateFile(fs, filePath, input.content ?? '', input.overwrite ?? false);
      return { textContent: result.ok ? { error: false as const, path: filePath } : { error: true as const, message: result.message, path: filePath } };
    },
  });
}
