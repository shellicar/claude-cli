import path from 'node:path';
import { Clock } from '@js-joda/core';
import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { ConfigReloader } from '@shellicar/claude-core/Config/ConfigReloader';
import { IConfigOptions } from '@shellicar/claude-core/Config/IConfigOptions';
import { IConfigFileReader, IConfigWatcher } from '@shellicar/claude-core/Config/interfaces';
import { NodeConfigFileReader } from '@shellicar/claude-core/Config/NodeConfigFileReader';
import { NodeDirectoryWatcher } from '@shellicar/claude-core/Config/NodeDirectoryWatcher';
import { readConfig } from '@shellicar/claude-core/Config/readConfig';
import { ConfigWatchHandle } from '@shellicar/claude-core/Config/types';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { IMemoryEnvironmentProvider } from '@shellicar/claude-core/memory/environment-provider';
import { IMemoryStore } from '@shellicar/claude-core/memory/interfaces';
import { IObjectStore } from '@shellicar/claude-core/persistence/interfaces';
import { IRandomProvider } from '@shellicar/claude-core/providers/IRandomProvider';
import { ISleepProvider } from '@shellicar/claude-core/providers/ISleepProvider';
import { MathRandomProvider } from '@shellicar/claude-core/providers/MathRandomProvider';
import { TimeoutSleepProvider } from '@shellicar/claude-core/providers/TimeoutSleepProvider';
import { Screen, StdoutScreen } from '@shellicar/claude-core/screen';
import {
  AccountLimitListener,
  AnthropicAuth,
  AnthropicClient,
  ApprovalCoordinator,
  Conversation,
  IDurableConfigProvider,
  IMessageStreamer,
  IQueryRunner,
  ISdkMessagePublisher,
  IStreamProcessor,
  IToolProvider,
  IToolRegistry,
  ITurnRunner,
  IWakeLock,
  QueryRunner,
  StreamProcessor,
  StreamInterruptListener,
  ToolRegistry,
  TurnRunner,
} from '@shellicar/claude-sdk';
import { NodeFileSystem } from '@shellicar/claude-sdk-tools/fs';
import { ITsServerOptions, TsServerService } from '@shellicar/claude-sdk-tools/TsService';
import { createServiceCollection, type IServiceProvider } from '@shellicar/core-di-lite';
import { AuditWriter } from '../AuditWriter.js';
import { HistoryPresentation } from '../app/HistoryPresentation.js';
import type { Presentation } from '../app/Presentation.js';
import { PrimaryPresentation } from '../app/PrimaryPresentation.js';
import { TerminalInput } from '../app/TerminalInput.js';
import { ViewHost } from '../app/ViewHost.js';
import { ClaudeMdLoader } from '../ClaudeMdLoader.js';
import { AgentMessageHandler } from '../controller/AgentMessageHandler.js';
import { ApprovalHandler } from '../controller/ApprovalHandler.js';
import { CancelHandler } from '../controller/CancelHandler.js';
import { CommandIntentExecutor } from '../controller/CommandIntentExecutor.js';
import { CommandKeyHandler } from '../controller/CommandKeyHandler.js';
import { EditorHandler } from '../controller/EditorHandler.js';
import { HistoryNavHandler } from '../controller/HistoryNavHandler.js';
import type { InputHandler } from '../controller/InputHandler.js';
import { QuitHandler } from '../controller/QuitHandler.js';
import { ViewSelectHandler } from '../controller/ViewSelectHandler.js';
import { createAppTools } from '../createAppTools.js';
import { GitStateMonitor } from '../GitStateMonitor.js';
import { logger } from '../logger.js';
import { AccountLimitNotice } from '../model/AccountLimitNotice.js';
import type { AppModeKey } from '../model/AppModeState.js';
import { AppModeState } from '../model/AppModeState.js';
import { ApprovalNotifier } from '../model/ApprovalNotifier.js';
import { AttachmentSource } from '../model/AttachmentSource.js';
import { CommandModeState } from '../model/CommandModeState.js';
import { ConversationSession } from '../model/ConversationSession.js';
import { ConversationState } from '../model/ConversationState.js';
import { IWakeLockSpawner } from '../model/IWakeLockSpawner.js';
import { NodeWakeLockSpawner } from '../model/NodeWakeLockSpawner.js';
import { PlatformWakeLock } from '../model/PlatformWakeLock.js';
import { StreamInterruptNotice } from '../model/StreamInterruptNotice.js';
import { EditorState } from '../model/EditorState.js';
import { HistoryViewState } from '../model/HistoryViewState.js';
import { IProcessLauncher } from '../model/IProcessLauncher.js';
import { ModelSettings } from '../model/ModelSettings.js';
import { NodeAttachmentSource } from '../model/NodeAttachmentSource.js';
import { NodeProcessLauncher } from '../model/NodeProcessLauncher.js';
import { PermissionsNoticeGate } from '../model/PermissionsNoticeGate.js';
import { PrimaryViewState } from '../model/PrimaryViewState.js';
import { StatusState } from '../model/StatusState.js';
import { TerminalState } from '../model/TerminalState.js';
import { ToolApprovalState } from '../model/ToolApprovalState.js';
import { DatabaseFactory } from '../persistence/DatabaseFactory.js';
import { IDatabaseOptions } from '../persistence/IDatabaseOptions.js';
import { SqliteMemoryEngine } from '../persistence/SqliteMemoryEngine.js';
import { SqliteMemoryStore } from '../persistence/SqliteMemoryStore.js';
import { SqliteObjectStore } from '../persistence/SqliteObjectStore.js';
import { ReadLine } from '../ReadLine.js';
import { SystemPromptLoader } from '../SystemPromptLoader.js';
import { Flasher } from '../view/Flasher.js';
import { HistoryView } from '../view/HistoryView.js';
import { PrimaryView } from '../view/PrimaryView.js';
import { TerminalRenderer } from '../view/TerminalRenderer.js';
import type { ViewModel } from '../view/View.js';
import { AppToolsService } from './AppToolsService.js';
import { ConsumerChannel } from './ConsumerChannel.js';
import { DurableConfigFactory } from './DurableConfigFactory.js';
import { GitMemoryEnvironmentProvider } from './GitMemoryEnvironmentProvider.js';
import { IRuntimeOptions } from './IRuntimeOptions.js';
import { ModelOverrides } from './ModelOverrides.js';
import { SdkChannel } from './SdkChannel.js';

/**
 * The runtime values `main` computes from argv/argc and hands the graph as
 * registered options objects (decision 8). Nothing is `new`'d in `main`; the
 * container owns all composition.
 */
export type ContainerOptions = {
  configOptions: IConfigOptions;
  runtimeOptions: IRuntimeOptions;
  tsServerOptions: ITsServerOptions;
  databaseOptions: IDatabaseOptions;
};

export function buildContainer(options: ContainerOptions): IServiceProvider {
  const services = createServiceCollection();

  // --- options objects (decision 8) — source isolated from use ---
  services.register(IConfigOptions).to(IConfigOptions, () => options.configOptions);
  services.register(IRuntimeOptions).to(IRuntimeOptions, () => options.runtimeOptions);
  services.register(ITsServerOptions).to(ITsServerOptions, () => options.tsServerOptions);
  services.register(IDatabaseOptions).to(IDatabaseOptions, () => options.databaseOptions);

  // --- cross-cutting providers + logger + filesystem (decision 4) ---
  services.register(ILogger).to(ILogger, () => logger);
  services.register(IFileSystem).to(NodeFileSystem);
  services.register(Clock).to(Clock, () => Clock.systemDefaultZone());
  services.register(ISleepProvider).to(TimeoutSleepProvider);
  services.register(IRandomProvider).to(MathRandomProvider);

  // --- config: holder (eager read) + reloader + watch-init factory ---
  services.register(IConfigFileReader).to(NodeConfigFileReader);
  services.register(IConfigWatcher).to(NodeDirectoryWatcher);
  services.register(ConfigLoader).to(ConfigLoader, (x) => new ConfigLoader(readConfig(x.resolve(IConfigOptions), x.resolve(IConfigFileReader), x.resolve(IFileSystem))));
  services.register(ConfigReloader).to(ConfigReloader);
  services.register(ConfigWatchHandle).to(ConfigWatchHandle, (x) => {
    const watcher = x.resolve(IConfigWatcher);
    const opts = x.resolve(IConfigOptions);
    const reloader = x.resolve(ConfigReloader);
    return watcher.watch(opts.paths, () => reloader.scheduleReload());
  });

  // --- persistence (decision 10/11) ---
  services.register(DatabaseFactory).to(DatabaseFactory);
  services.register(IObjectStore).to(IObjectStore, (x) => {
    const factory = x.resolve(DatabaseFactory);
    const loader = x.resolve(ConfigLoader);
    const db = factory.getDatabase(loader.config.persistence.database);
    return new SqliteObjectStore(db);
  });

  // --- memory (sibling of IObjectStore) ---
  // The store and provider are @dependsOn classes the container resolves with a bare `.to(Impl)`.
  // Only the engine needs a factory: its db is not a token, and the db-file selection from tenantId
  // is configuration, which belongs here. The opened db is handed to the engine, which runs its own
  // DDL/migrations on it in the constructor (eager init).
  services.register(IMemoryEnvironmentProvider).to(GitMemoryEnvironmentProvider);
  services.register(SqliteMemoryEngine).to(SqliteMemoryEngine, (x) => {
    const loader = x.resolve(ConfigLoader);
    const tenantId = loader.config.memory.tenantId;
    const db = x.resolve(DatabaseFactory).getDatabase(tenantId == null ? 'memory.db' : `memory.${tenantId}.db`);
    return new SqliteMemoryEngine(db, x.resolve(Clock));
  });
  services.register(IMemoryStore).to(SqliteMemoryStore);

  // --- ts server ---
  services.register(TsServerService).to(TsServerService);

  // --- tool suite (createAppTools is composition-root work) ---
  services.register(AppToolsService).to(AppToolsService, (x) => {
    const fs = x.resolve(IFileSystem);
    const tsServer = x.resolve(TsServerService);
    const loader = x.resolve(ConfigLoader);
    const objects = x.resolve(IObjectStore);
    const memory = x.resolve(IMemoryStore);
    const runtime = x.resolve(IRuntimeOptions);
    const tools = createAppTools({ fs, tsServer, toolsConfig: loader.config.tools, objects, memory, tsAvailable: runtime.tsAvailable });
    return new AppToolsService(tools);
  });
  // AppToolsService is factory-built, so its cache key is the factory; alias the
  // contract through resolve() to share the one instance (a plain .to(AppToolsService)
  // would zero-arg `new` it).
  services.register(IToolProvider).to(IToolProvider, (x) => x.resolve(AppToolsService));

  // --- SDK pipeline ---
  services.register(StreamProcessor).to(StreamProcessor);
  services.register(IStreamProcessor).to(StreamProcessor);
  services.register(IToolRegistry).to(IToolRegistry, (x) => new ToolRegistry(x.resolve(IToolProvider).tools, x.resolve(ILogger)));
  services.register(AnthropicAuth).to(AnthropicAuth, () => new AnthropicAuth({ redirect: 'local' }));
  services.register(IMessageStreamer).to(IMessageStreamer, (x) => new AnthropicClient(x.resolve(AnthropicAuth), x.resolve(ILogger)));
  services.register(ApprovalCoordinator).to(ApprovalCoordinator);
  services.register(AccountLimitNotice).to(AccountLimitNotice);
  services.register(AccountLimitListener).to(AccountLimitNotice);
  services.register(StreamInterruptNotice).to(StreamInterruptNotice);
  services.register(StreamInterruptListener).to(StreamInterruptNotice);
  services.register(IWakeLockSpawner).to(NodeWakeLockSpawner);
  services.register(IWakeLock).to(PlatformWakeLock);
  services.register(ITurnRunner).to(TurnRunner);
  services.register(Conversation).to(Conversation);
  services.register(IDurableConfigProvider).to(DurableConfigFactory);
  services.register(SdkChannel).to(SdkChannel);
  services.register(ISdkMessagePublisher).to(SdkChannel);
  services.register(ConsumerChannel).to(ConsumerChannel);
  services.register(QueryRunner).to(QueryRunner);
  services.register(IQueryRunner).to(QueryRunner);

  // --- contracts → concretes (decision 5) ---
  services.register(Screen).to(StdoutScreen);
  services.register(IProcessLauncher).to(NodeProcessLauncher);
  services.register(AttachmentSource).to(NodeAttachmentSource);
  services.register(ModelSettings).to(ModelOverrides);
  services.register(ModelOverrides).to(ModelOverrides);

  // --- state stores ---
  services.register(StatusState).to(StatusState, (x) => new StatusState(path.basename(x.resolve(IFileSystem).cwd())));
  services.register(ConversationState).to(ConversationState);
  services.register(ConversationSession).to(ConversationSession);
  services.register(EditorState).to(EditorState);
  services.register(ToolApprovalState).to(ToolApprovalState);
  services.register(CommandModeState).to(CommandModeState);
  services.register(TerminalState).to(TerminalState);
  services.register(PrimaryViewState).to(PrimaryViewState);
  services.register(AppModeState).to(AppModeState);
  services.register(HistoryViewState).to(HistoryViewState);

  // --- app services ---
  services.register(AuditWriter).to(AuditWriter);
  services.register(ClaudeMdLoader).to(ClaudeMdLoader);
  services.register(SystemPromptLoader).to(SystemPromptLoader);
  services.register(GitStateMonitor).to(GitStateMonitor);
  services.register(NodeAttachmentSource).to(NodeAttachmentSource);
  services.register(NodeProcessLauncher).to(NodeProcessLauncher);
  services.register(ApprovalNotifier).to(ApprovalNotifier);
  services.register(PermissionsNoticeGate).to(PermissionsNoticeGate, (x) => new PermissionsNoticeGate(x.resolve(ConfigLoader).config.permissions));

  // --- handlers ---
  services.register(CommandIntentExecutor).to(CommandIntentExecutor);
  // QuitHandler may not import the view layer (controller ↛ view), so the
  // renderer teardown is wired here as a closure rather than field-injected.
  services.register(QuitHandler).to(QuitHandler, (x) => new QuitHandler(() => x.resolve(TerminalRenderer).exit()));
  services.register(ApprovalHandler).to(ApprovalHandler);
  services.register(CommandKeyHandler).to(CommandKeyHandler);
  services.register(CancelHandler).to(CancelHandler);
  services.register(EditorHandler).to(EditorHandler);
  services.register(ViewSelectHandler).to(ViewSelectHandler);
  services.register(HistoryNavHandler).to(HistoryNavHandler);
  services.register(AgentMessageHandler).to(AgentMessageHandler);

  // --- views & presentations (assembled chains/maps are composition-root work) ---
  services.register(PrimaryView).to(PrimaryView);
  services.register(HistoryView).to(HistoryView);
  services.register(TerminalRenderer).to(TerminalRenderer, (x) => new TerminalRenderer(x.resolve(Screen), x.resolve(TerminalState)));
  services.register(PrimaryPresentation).to(PrimaryPresentation, (x) => {
    const editorChain: readonly InputHandler[] = [x.resolve(QuitHandler), x.resolve(ViewSelectHandler), x.resolve(ApprovalHandler), x.resolve(CommandKeyHandler), x.resolve(EditorHandler)];
    const streamingChain: readonly InputHandler[] = [x.resolve(QuitHandler), x.resolve(ViewSelectHandler), x.resolve(ApprovalHandler), x.resolve(CancelHandler)];
    return new PrimaryPresentation(x.resolve(PrimaryView), x.resolve(PrimaryViewState), editorChain, streamingChain);
  });
  services.register(HistoryPresentation).to(HistoryPresentation, (x) => {
    const chain: readonly InputHandler[] = [x.resolve(QuitHandler), x.resolve(ViewSelectHandler), x.resolve(HistoryNavHandler)];
    return new HistoryPresentation(x.resolve(HistoryView), chain);
  });
  services.register(ViewHost).to(ViewHost, (x) => {
    const model: ViewModel = {
      conversationState: x.resolve(ConversationState),
      editorState: x.resolve(EditorState),
      toolApprovalState: x.resolve(ToolApprovalState),
      commandModeState: x.resolve(CommandModeState),
      statusState: x.resolve(StatusState),
      terminalState: x.resolve(TerminalState),
      primaryViewState: x.resolve(PrimaryViewState),
      historyViewState: x.resolve(HistoryViewState),
      appModeState: x.resolve(AppModeState),
      session: x.resolve(ConversationSession),
      configLoader: x.resolve(ConfigLoader),
    };
    const presentations: ReadonlyMap<AppModeKey, Presentation> = new Map<AppModeKey, Presentation>([
      ['primary', x.resolve(PrimaryPresentation)],
      ['history', x.resolve(HistoryPresentation)],
    ]);
    return new ViewHost(x.resolve(TerminalRenderer), model, presentations, x.resolve(AppModeState));
  });
  services.register(TerminalInput).to(TerminalInput);
  services.register(ReadLine).to(ReadLine, (x) => {
    const input = x.resolve(TerminalInput);
    return new ReadLine((key) => input.handle(key));
  });
  services.register(Flasher).to(Flasher, (x) => new Flasher(x.resolve(ToolApprovalState)));

  return services.buildProvider();
}
