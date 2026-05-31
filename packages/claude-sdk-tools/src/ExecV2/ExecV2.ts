import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { defineTool } from '@shellicar/claude-sdk';
import { ExecV2InputSchema, ExecV2OutputSchema } from './schema';

export function createExecV2(_fs: IFileSystem) {
  return defineTool({
    name: 'Exec',
    operation: 'write',
    description: 'ExecV2: structural redesign in progress.',
    input_schema: ExecV2InputSchema,
    output_schema: ExecV2OutputSchema,
    input_examples: [
      {
        description: 'Run a command',
        pipeline: { id: 'a', program: 'echo', args: ['hello'] },
      },
    ],
    handler: async () => ({
      textContent: {
        results: [{ id: '_unimplemented', stdout: '', stderr: 'ExecV2: not implemented', exitCode: 1, signal: null }],
        success: false,
      },
    }),
  });
}
