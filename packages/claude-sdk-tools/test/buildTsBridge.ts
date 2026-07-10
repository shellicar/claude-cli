import os from 'node:os';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { createServiceCollection } from '@shellicar/core-di-lite';
import { ITsServerClient } from '../src/typescript/ITsServerClient';
import { ITsServerOptions } from '../src/typescript/ITsServerOptions';
import { ITypeScriptService } from '../src/typescript/ITypeScriptService';
import { resolveTsServerPath, TsServerClient } from '../src/typescript/TsServerClient';
import { TsServerBridge } from '../src/typescript/TsServerBridge';
import { MemoryFileSystem } from './MemoryFileSystem';

/**
 * Builds a TsServerBridge over a real TsServerClient, with a MemoryFileSystem
 * whose cwd() is `cwd` (relative file args resolve onto real disk there) and
 * whose homedir() is the real OS home (where the client spawns tsserver).
 */
export function buildTsBridge(cwd: string): TsServerBridge {
  const services = createServiceCollection();
  services.register(ITsServerOptions).to(ITsServerOptions, () => ({ tsserverPath: resolveTsServerPath() }));
  services.register(IFileSystem).to(IFileSystem, () => new MemoryFileSystem({}, os.homedir(), cwd));
  services.register(ITsServerClient).to(TsServerClient);
  services.register(ITypeScriptService).to(TsServerBridge);
  services.register(TsServerBridge).to(TsServerBridge);
  return services.buildProvider().resolve(TsServerBridge);
}
