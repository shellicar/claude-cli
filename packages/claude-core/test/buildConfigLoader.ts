import { createServiceCollection } from '@shellicar/core-di-lite';
import type { z } from 'zod';
import { ConfigLoader } from '../src/Config/ConfigLoader';
import { ConfigReloader } from '../src/Config/ConfigReloader';
import { IConfigOptions } from '../src/Config/IConfigOptions';
import { IConfigFileReader, IConfigWatcher } from '../src/Config/interfaces';
import { readConfig } from '../src/Config/readConfig';
import { type ConfigSourceOverride, ConfigWatchHandle } from '../src/Config/types';
import { IFileSystem } from '../src/fs/interfaces';
import { ILogger } from '../src/logging/ILogger';

/**
 * Builds a ConfigLoader holder through a real core-di-lite container, so tests
 * exercise the actual property-injection and eager-read path. The holder is
 * constructed via the factory (`new ConfigLoader(readConfig(...))`), so it is
 * already loaded on return — there is no `load()` step. When a watcher is
 * supplied, the `ConfigWatchHandle` factory is resolved eagerly so the watch
 * is active and `watcher.trigger(path)` drives a reload through `ConfigReloader`.
 */
export type BuildConfigLoaderOptions<T extends z.ZodType> = {
  schema: T;
  paths: readonly string[];
  reader: IConfigFileReader;
  fs: IFileSystem;
  watcher?: IConfigWatcher;
  pathFields?: readonly (readonly string[])[];
  overrides?: ConfigSourceOverride;
  debounceMs?: number;
  logger?: ILogger;
};

class NoopConfigWatcher extends IConfigWatcher {
  public watch(): ConfigWatchHandle {
    return { [Symbol.dispose]() {} };
  }
}

class NoopLogger extends ILogger {
  public trace(): void {}
  public debug(): void {}
  public info(): void {}
  public warn(): void {}
  public error(): void {}
}

export const buildConfigLoader = <T extends z.ZodType>(options: BuildConfigLoaderOptions<T>): ConfigLoader<T> => {
  const services = createServiceCollection();
  services.register(IConfigOptions).to(IConfigOptions, () => ({
    schema: options.schema,
    paths: options.paths,
    pathFields: options.pathFields,
    overrides: options.overrides,
    debounceMs: options.debounceMs,
  }));
  services.register(IConfigFileReader).to(IConfigFileReader, () => options.reader);
  services.register(IConfigWatcher).to(IConfigWatcher, () => options.watcher ?? new NoopConfigWatcher());
  services.register(IFileSystem).to(IFileSystem, () => options.fs);
  services.register(ILogger).to(ILogger, () => options.logger ?? new NoopLogger());
  services.register(ConfigLoader).to(ConfigLoader, (x) => new ConfigLoader(readConfig(x.resolve(IConfigOptions), x.resolve(IConfigFileReader), x.resolve(IFileSystem))));
  services.register(ConfigReloader).to(ConfigReloader);
  services.register(ConfigWatchHandle).to(ConfigWatchHandle, (x) => {
    const watcher = x.resolve(IConfigWatcher);
    const opts = x.resolve(IConfigOptions);
    const reloader = x.resolve(ConfigReloader);
    return watcher.watch(opts.paths, () => reloader.scheduleReload());
  });
  const provider = services.buildProvider();
  // Start the watch eagerly, exactly as the app composition root does.
  provider.resolve(ConfigWatchHandle);
  return provider.resolve(ConfigLoader) as ConfigLoader<T>;
};
