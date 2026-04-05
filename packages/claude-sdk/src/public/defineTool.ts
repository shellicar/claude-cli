import type { z } from 'zod';
import type { ToolDefinition } from './types';

export function defineTool<TSchema extends z.ZodType, TOutput = unknown>(def: ToolDefinition<TSchema, TOutput>): ToolDefinition<TSchema, TOutput> {
  return def;
}
