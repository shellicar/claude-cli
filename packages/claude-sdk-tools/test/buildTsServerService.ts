import { createServiceCollection } from '@shellicar/core-di-lite';
import { ITsServerOptions } from '../src/typescript/ITsServerOptions';
import { resolveTsServerPath, TsServerService } from '../src/typescript/TsServerService';

/**
 * Builds a TsServerService through a real core-di-lite container, injecting
 * ITsServerOptions (cwd + the resolved tsserver path). Replaces the old
 * `new TsServerService({ cwd })` form now that the class is property-injected.
 */
export function buildTsServerService(cwd: string): TsServerService {
  const services = createServiceCollection();
  services.register(ITsServerOptions).to(ITsServerOptions, () => ({ cwd, tsserverPath: resolveTsServerPath() }));
  services.register(TsServerService).to(TsServerService);
  return services.buildProvider().resolve(TsServerService);
}
