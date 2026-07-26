import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { ConfigReloader } from '@shellicar/claude-core/Config/ConfigReloader';
import { IConfigOptions } from '@shellicar/claude-core/Config/IConfigOptions';
import { IConfigFileReader, IConfigWatcher } from '@shellicar/claude-core/Config/interfaces';
import { ConfigWatchHandle } from '@shellicar/claude-core/Config/types';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { IDurableConfigProvider } from '@shellicar/claude-sdk';
import { createServiceCollection, type IServiceProvider, Lifetime } from '@shellicar/core-di';
import { describe, expect, it } from 'vitest';
import { IAgentPresence } from '../src/agent/AgentPresence.js';
import { ClaudeMdLoader } from '../src/ClaudeMdLoader.js';
import { IConversationSession } from '../src/model/ConversationSession.js';
import { StatusState } from '../src/model/StatusState.js';
import { IWorkingDirectory } from '../src/model/WorkingDirectory.js';
import { IRulesConfigNotifier, RulesConfigWatchHandle } from '../src/setup/ConfigRulesConfigProvider.js';
import { IRuntimeOptions } from '../src/setup/IRuntimeOptions.js';
import { IWorkingDirectoryMoveHandler, WorkingDirectoryMoveHandler } from '../src/setup/WorkingDirectoryMoveHandler.js';

class FakeWatchHandle {
  public disposed = false;
  public [Symbol.dispose](): void {
    this.disposed = true;
  }
}

type Built = {
  provider: IServiceProvider;
  emitChange: (cwd: string) => void;
  watchesCreatedOnMove: FakeWatchHandle[];
};

function buildMoveHandler(): Built {
  let changeListener: ((cwd: string) => void) | null = null;
  const services = createServiceCollection({ defaultLifetime: Lifetime.Singleton });
  services
    .register(IWorkingDirectory)
    .using(
      () =>
        ({
          on: (event: string, listener: (cwd: string) => void) => {
            if (event === 'change') {
              changeListener = listener;
            }
          },
        }) as unknown as IWorkingDirectory,
    )
    .asSelf();
  const watchesCreatedOnMove: FakeWatchHandle[] = [];
  services
    .register(IConfigWatcher)
    .using(
      () =>
        ({
          watch: () => {
            const handle = new FakeWatchHandle();
            watchesCreatedOnMove.push(handle);
            return handle as unknown as ConfigWatchHandle;
          },
        }) as unknown as IConfigWatcher,
    )
    .asSelf();
  services
    .register(IConfigOptions)
    .using(() => ({ paths: [] }) as unknown as IConfigOptions)
    .asSelf();
  services
    .register(ConfigReloader)
    .using(() => ({ scheduleReload: () => {}, reload: () => {} }) as unknown as ConfigReloader)
    .asSelf();
  services
    .register(IRulesConfigNotifier)
    .using(() => ({ refresh: () => {} }) as unknown as IRulesConfigNotifier)
    .asSelf();
  services
    .register(StatusState)
    .using(() => ({ setCwdBasename: () => {} }) as unknown as StatusState)
    .asSelf();
  services
    .register(IAgentPresence)
    .using(() => ({ attach: () => {} }) as unknown as IAgentPresence)
    .asSelf();
  services
    .register(IDurableConfigProvider)
    .using(() => ({ resolveSystemPromptsFor: async () => {}, update: () => {} }) as unknown as IDurableConfigProvider)
    .asSelf();
  services
    .register(ConfigLoader)
    .using(() => ({ config: { claudeMd: { enabled: false } } }) as unknown as ConfigLoader<never>)
    .asSelf();
  // ConfigReloader's own @dependsOn tokens are planned even though a factory supplies the stub,
  // so its leaves need registrations too (same shape as Application.spec's EditorHandler note).
  services
    .register(IConfigFileReader)
    .using(() => ({}) as unknown as IConfigFileReader)
    .asSelf();
  services
    .register(IFileSystem)
    .using(() => ({}) as unknown as IFileSystem)
    .asSelf();
  services
    .register(ILogger)
    .using(() => ({}) as unknown as ILogger)
    .asSelf();
  services
    .register(IRuntimeOptions)
    .using(() => ({}) as unknown as IRuntimeOptions)
    .asSelf();
  services
    .register(ClaudeMdLoader)
    .using(() => ({}) as unknown as ClaudeMdLoader)
    .asSelf();
  services
    .register(IConversationSession)
    .using(() => ({ id: '0d7c9145-64cf-4a44-9b06-6b1b6f2f9a02' }) as unknown as IConversationSession)
    .asSelf();
  // The container's registered watch handles — what any later resolver of these tokens receives.
  services
    .register(ConfigWatchHandle)
    .using(() => new FakeWatchHandle() as unknown as ConfigWatchHandle)
    .asSelf();
  services
    .register(RulesConfigWatchHandle)
    .using(() => new FakeWatchHandle() as unknown as ConfigWatchHandle)
    .asSelf();
  services.register(WorkingDirectoryMoveHandler).as(IWorkingDirectoryMoveHandler);
  const provider = services.buildProvider();
  return { provider, emitChange: (cwd: string) => changeListener?.(cwd), watchesCreatedOnMove };
}

describe('WorkingDirectoryMoveHandler', () => {
  // Each move creates two watches (config, then rules). A second move supersedes the first move's
  // pair; nothing else holds them — unlike the container-registered startup handles above — so
  // leaving them undisposed leaks a live fs watch per move, still firing on the departed directory.
  it('disposes the config watch a prior move created when a second move supersedes it', () => {
    const { provider, emitChange, watchesCreatedOnMove } = buildMoveHandler();
    provider.resolve(IWorkingDirectoryMoveHandler).wire();
    emitChange('/first/move');
    emitChange('/second/move');
    const expected = true;
    const actual = watchesCreatedOnMove[0].disposed;
    expect(actual).toBe(expected);
  });

  it('disposes the rules watch a prior move created when a second move supersedes it', () => {
    const { provider, emitChange, watchesCreatedOnMove } = buildMoveHandler();
    provider.resolve(IWorkingDirectoryMoveHandler).wire();
    emitChange('/first/move');
    emitChange('/second/move');
    const expected = true;
    const actual = watchesCreatedOnMove[1].disposed;
    expect(actual).toBe(expected);
  });

  // The startup watches are superseded by the first move exactly as a move-created pair is by a
  // second: nothing should keep watching (and reloading on) a directory the session has left.
  it('disposes the startup config watch when the first move supersedes it', () => {
    const { provider, emitChange } = buildMoveHandler();
    provider.resolve(IWorkingDirectoryMoveHandler).wire();
    emitChange('/somewhere/else');
    const expected = true;
    const actual = (provider.resolve(ConfigWatchHandle) as unknown as FakeWatchHandle).disposed;
    expect(actual).toBe(expected);
  });

  it('disposes the startup rules watch when the first move supersedes it', () => {
    const { provider, emitChange } = buildMoveHandler();
    provider.resolve(IWorkingDirectoryMoveHandler).wire();
    emitChange('/somewhere/else');
    const expected = true;
    const actual = (provider.resolve(RulesConfigWatchHandle) as unknown as FakeWatchHandle).disposed;
    expect(actual).toBe(expected);
  });
});
