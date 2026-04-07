import { generateJsonSchema as coreGenerateJsonSchema } from '@shellicar/claude-core/config';
import { cliConfigSchema } from './schema';

export function generateJsonSchema(): Record<string, unknown> {
  return coreGenerateJsonSchema(cliConfigSchema);
}
