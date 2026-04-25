import type { ToolAttachmentBlock, ToolDefinition } from '@shellicar/claude-sdk';
import type { z } from 'zod';

export async function call<T extends z.ZodType, TOut extends z.ZodType>(tool: ToolDefinition<T, TOut>, input: z.input<T>): Promise<z.output<TOut>> {
  const { textContent } = await tool.handler(tool.input_schema.parse(input));
  return textContent;
}

export async function callFull<T extends z.ZodType, TOut extends z.ZodType>(
  tool: ToolDefinition<T, TOut>,
  input: z.input<T>,
): Promise<{ textContent: z.output<TOut>; attachments?: ToolAttachmentBlock[] }> {
  return tool.handler(tool.input_schema.parse(input));
}