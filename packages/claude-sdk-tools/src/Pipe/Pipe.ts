import { type AnyToolDefinition, defineTool } from '@shellicar/claude-sdk';
import { PipeToolInputSchema } from './schema';

export function createPipe(tools: AnyToolDefinition[]) {
  const registry = new Map(tools.map((t) => [t.name, t]));

  return defineTool({
    name: 'Pipe',
    description: 'Execute a sequence of read tools in order, threading the output of each step into the content field of the next. Use to chain Find or ReadFile with Grep, Head, Tail, and Range in a single tool call instead of multiple round-trips. Write tools (EditFile, CreateFile, DeleteFile etc.) are not allowed.',
    operation: 'read',
    input_schema: PipeToolInputSchema,
    input_examples: [
      {
        steps: [
          { tool: 'Find', input: { path: '.' } },
          { tool: 'Grep', input: { pattern: '\\.ts$' } },
          { tool: 'Head', input: { count: 10 } },
        ],
      },
      {
        steps: [
          { tool: 'ReadFile', input: { path: './src/index.ts' } },
          { tool: 'Grep', input: { pattern: 'export', context: 2 } },
        ],
      },
    ],
    handler: async (input) => {
      let pipeValue: unknown;

      for (const step of input.steps) {
        const tool = registry.get(step.tool);
        if (!tool) {
          throw new Error(`Pipe: unknown tool "${step.tool}". Available: ${[...registry.keys()].join(', ')}`);
        }
        if (tool.operation !== 'read') {
          throw new Error(`Pipe: tool "${step.tool}" has operation "${tool.operation ?? 'unknown'}" — only read tools may be used in a pipe`);
        }

        const toolInput = pipeValue !== undefined ? { ...step.input, content: pipeValue } : step.input;

        const parseResult = tool.input_schema.safeParse(toolInput);
        if (!parseResult.success) {
          throw new Error(`Pipe: step "${step.tool}" input validation failed: ${parseResult.error.message}`);
        }
        const handler = tool.handler as (input: unknown) => Promise<unknown>;
        pipeValue = await handler(parseResult.data);
      }

      return pipeValue;
    },
  });
}
