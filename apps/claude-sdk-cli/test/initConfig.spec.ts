import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { defaultConfig } from '../src/cli-config/initConfig';
import { sdkConfigSchema } from '../src/cli-config/schema';

function unwrapToObject(schema: { _zod: { def: { type: string; innerType?: any } } }): z.ZodObject | null {
  if (schema._zod.def.type === 'object') {
    return schema as unknown as z.ZodObject;
  }
  if (schema._zod.def.innerType) {
    return unwrapToObject(schema._zod.def.innerType);
  }
  return null;
}

describe('defaultConfig', () => {
  it('default config has all properties', () => {
    const c = defaultConfig();

    const recurse = (shape: z.ZodRawShape, obj: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(shape)) {
        expect(obj).toHaveProperty(key);
        const unwrapped = unwrapToObject(value);
        if (unwrapped) {
          recurse(unwrapped.shape, obj[key] as Record<string, unknown>);
        }
      }
    };

    recurse(sdkConfigSchema.shape, c);
  });
});
