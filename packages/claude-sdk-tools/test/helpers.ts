import type { ToolAttachmentBlock, ToolDefinition } from '@shellicar/claude-sdk';
import type { z } from 'zod';

export async function call<T extends z.ZodType, TOut extends z.ZodType>(tool: ToolDefinition<T, TOut>, input: z.input<T>): Promise<z.output<TOut>> {
  const { textContent } = await tool.handler(tool.input_schema.parse(input));
  return textContent;
}

export async function callFull<T extends z.ZodType, TOut extends z.ZodType>(tool: ToolDefinition<T, TOut>, input: z.input<T>): Promise<{ textContent: z.output<TOut>; attachments?: ToolAttachmentBlock[] }> {
  return tool.handler(tool.input_schema.parse(input));
}

/** Drive a composable stage/source `run` directly with a canonical (model fields + the `input` stream).
 *  The canonical's exact shape varies per tool, so it is passed loosely here — in production the Pipe
 *  builds it via `reconcile`. */
export function runStage<O>(tool: { run: (canonical: never) => Promise<O> }, canonical: object): Promise<O> {
  return tool.run(canonical as never);
}
