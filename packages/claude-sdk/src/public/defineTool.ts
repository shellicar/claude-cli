import type { z } from 'zod';
import type { ToolDefinition } from './types';

export function defineTool<TSchema extends z.ZodType, TOutputSchema extends z.ZodType>(def: ToolDefinition<TSchema, TOutputSchema>): ToolDefinition<TSchema, TOutputSchema> {
  return def;
}
