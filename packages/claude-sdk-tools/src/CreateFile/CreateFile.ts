import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ToolDefinition } from '@shellicar/claude-sdk';
import { expandPath } from '@shellicar/mcp-exec';
import { CreateFileInputSchema } from './schema';
import type { CreateFileInput, CreateFileOutput } from './types';

export const CreateFile: ToolDefinition<CreateFileInput, CreateFileOutput> = {
  name: 'CreateFile',
  description: 'Create a new file with optional content. Creates parent directories automatically. By default errors if the file already exists. Set overwrite: true to replace an existing file (errors if file does not exist).',
  input_schema: CreateFileInputSchema,
  input_examples: [
    { path: './src/NewFile.ts', },
    { path: './src/NewFile.ts', content: 'export const foo = 1;\n' },
    { path: './src/NewFile.ts', content: 'export const foo = 1;\n', overwrite: true },
  ],
  handler: async (input): Promise<CreateFileOutput> => {
    const { overwrite = false, content = '' } = input;

    const path = expandPath(input.path);
    const exists = existsSync(path);

    if (!overwrite && exists) {
      return { error: true, message: 'File already exists. Set overwrite: true to replace it.', path };
    }
    if (overwrite && !exists) {
      return { error: true, message: 'File does not exist. Set overwrite: false to create it.', path };
    }

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf-8');

    return { error: false, path };
  },
};

