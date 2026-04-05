import { cleanSchema } from './cleanSchema';
import { cliConfigSchema } from './schema';

export function generateJsonSchema(): Record<string, unknown> {
  const raw = cliConfigSchema.toJSONSchema({ target: 'draft-07' });
  return cleanSchema(raw, true) as Record<string, unknown>;
}
