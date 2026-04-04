import type { ToolDefinition } from '@shellicar/claude-sdk';
import type { z } from 'zod';

export async function call<T extends z.ZodType, O>(tool: ToolDefinition<T, O>, input: z.input<T>): Promise<O> {
  return tool.handler(tool.input_schema.parse(input));
}
