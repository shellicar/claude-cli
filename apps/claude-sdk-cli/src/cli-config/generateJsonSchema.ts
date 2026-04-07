import { generateJsonSchema as coreGenerateJsonSchema } from '@shellicar/claude-core/config';
import { sdkConfigSchema } from './schema';

export function generateJsonSchema(): Record<string, unknown> {
  return coreGenerateJsonSchema(sdkConfigSchema);
}
