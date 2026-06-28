import type { z } from 'zod';
import type { MergeOptions } from '../config';
import type { ConfigSourceOverride } from './types';

/**
 * The static/runtime values a ConfigLoader needs that are not injectable
 * services: the schema, the ordered file paths, the path-field segments, the
 * highest-precedence override layer derived from argv, and the merge/debounce
 * tuning. Carried on one registered object (decision 8) so ConfigLoader injects
 * services by property and reads these values off the injected options.
 */
export abstract class IConfigOptions<T extends z.ZodType = z.ZodType> {
  public abstract readonly schema: T;
  public abstract readonly paths: readonly string[];
  public abstract readonly pathFields?: readonly (readonly string[])[];
  public abstract readonly overrides?: ConfigSourceOverride;
  public abstract readonly mergeOptions?: MergeOptions;
  public abstract readonly debounceMs?: number;
}
