import os from 'node:os';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { createServiceCollection } from '@shellicar/core-di-lite';
import { ITsServerClient } from '../../src/typescript/ITsServerClient';
import { ITsServerOptions } from '../../src/typescript/ITsServerOptions';
import { ITypeScriptService } from '../../src/typescript/ITypeScriptService';
import { TsServerBridge } from '../../src/typescript/TsServerBridge';
import { resolveTsServerPath, TsServerClient } from '../../src/typescript/TsServerClient';
import { MemoryFileSystem } from '../MemoryFileSystem';

// The suite spawns several real tsservers in parallel; under that contention a
// single open can exceed the production default, so the harness uses a generous
// ceiling. The timeout being injectable is exactly what makes this possible.
const TEST_TSSERVER_TIMEOUT_MS = 15000;

class NoopLogger extends ILogger {
  public trace(): void {}
  public debug(): void {}
  public info(): void {}
  public warn(): void {}
  public error(): void {}
}

/**
 * Builds a TsServerBridge over a real TsServerClient, with a MemoryFileSystem
 * whose cwd() is `cwd` (relative file args resolve onto real disk there) and
 * whose homedir() is the real OS home (where the client spawns tsserver).
 */
export function buildTsBridge(cwd: string): TsServerBridge {
  const services = createServiceCollection();
  services.register(ITsServerOptions).using(() => ({ tsserverPath: resolveTsServerPath(), timeoutMs: TEST_TSSERVER_TIMEOUT_MS })).asSelf();
  services.register(IFileSystem).using(() => new MemoryFileSystem({}, os.homedir(), cwd)).asSelf();
  services.register(NoopLogger).as(ILogger);
  services.register(TsServerClient).as(ITsServerClient);
  services.register(TsServerBridge).asSelf().as(ITypeScriptService);
  return services.buildProvider().resolve(TsServerBridge);
}

/**
 * Builds a bare TsServerClient (the anti-corruption API) over the given
 * `tsserverPath`. Pass a real path (via resolveTsServerPath()) for a working
 * server, or a bogus path to drive the failure paths: the spawned process dies,
 * so a request surfaces TsServerError instead of reading as a clean file.
 */
export function buildTsClient(tsserverPath: string | null, cwd: string): ITsServerClient {
  const services = createServiceCollection();
  services.register(ITsServerOptions).using(() => ({ tsserverPath, timeoutMs: TEST_TSSERVER_TIMEOUT_MS })).asSelf();
  services.register(IFileSystem).using(() => new MemoryFileSystem({}, os.homedir(), cwd)).asSelf();
  services.register(NoopLogger).as(ILogger);
  services.register(TsServerClient).as(ITsServerClient);
  return services.buildProvider().resolve(ITsServerClient);
}
