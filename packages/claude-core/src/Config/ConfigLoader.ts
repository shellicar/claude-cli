import type { z } from 'zod';
import type { ConfigChangeListener, ConfigLoaderOptions, ConfigSource, ConfigUnsubscribe } from './types';
import { IConfigLoader } from './interfaces';

/**
 * Concrete config loader. Owns the full lifecycle: load, watch, diff,
 * emit.
 *
 * All I/O flows through `IConfigFileReader` and `IConfigWatcher` so the
 * class is fully testable with in-memory fakes.
 */
export class ConfigLoader<T extends z.ZodType> extends IConfigLoader<T> {
  public constructor(_options: ConfigLoaderOptions<T>) {
    super();
    // stub: phase 1 scaffold
  }

  public load(): void {
    throw new Error('not implemented');
  }

  public start(): void {
    throw new Error('not implemented');
  }

  public dispose(): void {
    throw new Error('not implemented');
  }

  public get config(): z.infer<T> {
    throw new Error('not implemented');
  }

  public get sources(): readonly ConfigSource[] {
    throw new Error('not implemented');
  }

  public get warnings(): readonly string[] {
    throw new Error('not implemented');
  }

  public onChange(_listener: ConfigChangeListener<z.infer<T>>): ConfigUnsubscribe {
    throw new Error('not implemented');
  }
}
