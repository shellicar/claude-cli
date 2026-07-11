import os from 'node:os';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { createServiceCollection } from '@shellicar/core-di-lite';
import { ITsServerClient } from '../src/typescript/ITsServerClient';
import { ITsServerOptions } from '../src/typescript/ITsServerOptions';
import { ITypeScriptService } from '../src/typescript/ITypeScriptService';
import { TsServerBridge } from '../src/typescript/TsServerBridge';
import { resolveTsServerPath, TsServerClient } from '../src/typescript/TsServerClient';
import { MemoryFileSystem } from './MemoryFileSystem';

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
  services.register(ITsServerOptions).to(ITsServerOptions, () => ({ tsserverPath: resolveTsServerPath(), timeoutMs: TEST_TSSERVER_TIMEOUT_MS }));
  services.register(IFileSystem).to(IFileSystem, () => new MemoryFileSystem({}, os.homedir(), cwd));
  services.register(ILogger).to(NoopLogger);
  services.register(ITsServerClient).to(TsServerClient);
  services.register(ITypeScriptService).to(TsServerBridge);
  services.register(TsServerBridge).to(TsServerBridge);
  return services.buildProvider().resolve(TsServerBridge);
}
