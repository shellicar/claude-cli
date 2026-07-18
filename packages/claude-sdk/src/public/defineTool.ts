import type { z } from 'zod';
import type { ToolDefinition } from './types';

// Anthropic's tool name schema (tools[].custom.name). Checked here, once, at definition time,
// so a bad name fails loudly at startup (module load / createAppTools) instead of surfacing as
// an HTTP 400 on the first request that happens to reach the API with this tool registered.
const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

export function defineTool<TSchema extends z.ZodType, TOutputSchema extends z.ZodType>(def: ToolDefinition<TSchema, TOutputSchema>): ToolDefinition<TSchema, TOutputSchema> {
  if (!TOOL_NAME_PATTERN.test(def.name)) {
    throw new Error(`Tool name "${def.name}" is invalid: must match ${TOOL_NAME_PATTERN} (Anthropic's tools[].custom.name schema — letters, digits, underscore, hyphen only, no dots).`);
  }
  return def;
}
