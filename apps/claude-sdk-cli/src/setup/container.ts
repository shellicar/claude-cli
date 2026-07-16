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
import { expandPath } from '@shellicar/claude-core/fs/expandPath';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { IHistoryReader, IHistoryWriter } from '@shellicar/claude-core/history/interfaces';
import { NodeSipsBridge } from '@shellicar/claude-core/image/NodeSipsBridge';
import { SipsBridge } from '@shellicar/claude-core/image/SipsBridge';
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
  IModelCatalog,
  IQueryRunner,
  IRequestClockListener,
  ISdkMessagePublisher,
  IStreamProcessor,
  IToolBlockNotifier,
  IToolProvider,
  IToolRegistry,
  IToolsClockListener,
  ITurnRunner,
  IWakeLock,
  ModelCatalog,
  QueryRunner,
  StreamInterruptListener,
  StreamProcessor,
  ToolBlockNotifier,
  ToolRegistry,
  TurnRunner,
} from '@shellicar/claude-sdk';
import { NodeFileSystem } from '@shellicar/claude-sdk-tools/fs';
import { ITsServerClient, ITsServerOptions, ITypeScriptService, TsServerBridge, TsServerClient } from '@shellicar/claude-sdk-tools/TsService';
import { createServiceCollection, type IServiceProvider } from '@shellicar/core-di-lite';
import { AuditStats } from '../AuditStats.js';
import { AuditWriter } from '../AuditWriter.js';
import { HistoryPresentation } from '../app/HistoryPresentation.js';
import type { Presentation } from '../app/Presentation.js';
import { PrimaryPresentation } from '../app/PrimaryPresentation.js';
import { TerminalInput } from '../app/TerminalInput.js';
import { ViewHost } from '../app/ViewHost.js';
import { ApprovalHolder, IApprovalHolder } from '../approval/ApprovalHolder.js';
import { IBus } from '../bus/IBus.js';
import { NatsBus } from '../bus/NatsBus.js';
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
import { ScrollHandler } from '../controller/ScrollHandler.js';
import { ViewSelectHandler } from '../controller/ViewSelectHandler.js';
import { ConvChangePublisher, IConvChangePublisher } from '../conv/ConvChangePublisher.js';
import { ConvServe, IConvServe } from '../conv/ConvServe.js';
import { ConvServicer, IConvServicer } from '../conv/ConvServicer.js';
import { ConvTelemetryProjector, IConvTelemetryProjector } from '../conv/ConvTelemetryProjector.js';
import { IWireSayInbox, WireSayInbox } from '../conv/WireSayInbox.js';
import { createAppTools } from '../createAppTools.js';
import { GitStateMonitor } from '../GitStateMonitor.js';
import { logger } from '../logger.js';
import { AccountLimitNotice } from '../model/AccountLimitNotice.js';
import type { AppModeKey } from '../model/AppModeState.js';
import { AppModeState } from '../model/AppModeState.js';
import { ApprovalNotifier } from '../model/ApprovalNotifier.js';
import { AttachmentSource } from '../model/AttachmentSource.js';
import { RequestClockAdapter, ToolsClockAdapter } from '../model/ClockListeners.js';
import { CommandModeState } from '../model/CommandModeState.js';
import { ConversationSession } from '../model/ConversationSession.js';
import { ConversationState } from '../model/ConversationState.js';
import { EditorState } from '../model/EditorState.js';
import { HistoryViewState } from '../model/HistoryViewState.js';
import { IProcessLauncher } from '../model/IProcessLauncher.js';
import { ISystemIdentity } from '../model/ISystemIdentity.js';
import { ITurnClock } from '../model/ITurnClock.js';
import { IWakeLockSpawner } from '../model/IWakeLockSpawner.js';
import { ModelSettings } from '../model/ModelSettings.js';
import { NodeAttachmentSource } from '../model/NodeAttachmentSource.js';
import { NodeProcessLauncher } from '../model/NodeProcessLauncher.js';
import { NodeWakeLockSpawner } from '../model/NodeWakeLockSpawner.js';
import { PermissionsNoticeGate } from '../model/PermissionsNoticeGate.js';
import { PlatformWakeLock } from '../model/PlatformWakeLock.js';
import { PrimaryViewState } from '../model/PrimaryViewState.js';
import { ScrollState } from '../model/ScrollState.js';
import { StatusState } from '../model/StatusState.js';
import { StreamInterruptNotice } from '../model/StreamInterruptNotice.js';
import { SystemIdentity } from '../model/SystemIdentity.js';
import { TerminalState } from '../model/TerminalState.js';
import { ToolApprovalState } from '../model/ToolApprovalState.js';
import { TurnClock } from '../model/TurnClock.js';
import { WorkingDirectory } from '../model/WorkingDirectory.js';
import { DatabaseFactory } from '../persistence/DatabaseFactory.js';
import { IDatabaseOptions } from '../persistence/IDatabaseOptions.js';
import { SqliteHistoryEngine } from '../persistence/SqliteHistoryEngine.js';
import { SqliteMemoryEngine } from '../persistence/SqliteMemoryEngine.js';
import { SqliteMemoryStore } from '../persistence/SqliteMemoryStore.js';
import { SqliteObjectStore } from '../persistence/SqliteObjectStore.js';
import { SqliteSessionStore } from '../persistence/SqliteSessionStore.js';
import { ReadLine } from '../ReadLine.js';
import { SystemPromptLoader } from '../SystemPromptLoader.js';
import { Flasher } from '../view/Flasher.js';
import { HistoryView } from '../view/HistoryView.js';
import { PrimaryView } from '../view/PrimaryView.js';
import { TerminalRenderer } from '../view/TerminalRenderer.js';
import type { ViewModel } from '../view/View.js';
import { AppToolsService } from './AppToolsService.js';
import { ConsumerChannel } from './ConsumerChannel.js';
import { CwdTracker } from './CwdTracker.js';
import { DurableConfigFactory } from './DurableConfigFactory.js';
import { GitMemoryEnvironmentProvider } from './GitMemoryEnvironmentProvider.js';
import { IRuntimeOptions } from './IRuntimeOptions.js';
import { ModelOverrides } from './ModelOverrides.js';
import { SdkChannel } from './SdkChannel.js';
import { SkillCatalogueTracker } from './SkillCatalogueTracker.js';

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

  // --- session store (sibling of IObjectStore) ---
  // Owns its own database file (`sessions.db`); the opened db is handed to the store, which runs its migrations on
  // it in the constructor (eager init), matching the memory-engine wiring above.
  services.register(SqliteSessionStore).to(SqliteSessionStore, (x) => {
    const db = x.resolve(DatabaseFactory).getDatabase('sessions.db');
    return new SqliteSessionStore(db);
  });

  // --- history index (sibling of the memory store) ---
  // The engine plays both the read and write seams; each interface resolves to the one engine. It owns `history.db`;
  // the opened db is handed to the engine, which runs its migrations on it in the constructor (eager init).
  services.register(SqliteHistoryEngine).to(SqliteHistoryEngine, (x) => new SqliteHistoryEngine(x.resolve(DatabaseFactory).getDatabase('history.db')));
  services.register(IHistoryReader).to(IHistoryReader, (x) => x.resolve(SqliteHistoryEngine));
  services.register(IHistoryWriter).to(IHistoryWriter, (x) => x.resolve(SqliteHistoryEngine));

  // --- ts server ---
  // Class 1: the anti-corruption wire client, cycled per tool block.
  services.register(ITsServerClient).to(TsServerClient);
  // Class 2: the model-facing bridge, a plain @dependsOn class registered under
  // ITypeScriptService — the live contract every consumer resolves. Its
  // blockEnded() reaches the pipeline NOT through a DI binding but by being
  // declared as each TS tool's blockLifetime (see createAppTools).
  services.register(ITypeScriptService).to(TsServerBridge);

  // --- tool suite (createAppTools is composition-root work) ---
  services.register(AppToolsService).to(AppToolsService, (x) => {
    const fs = x.resolve(IFileSystem);
    // The bridge as ITypeScriptService: the live contract for the tools'
    // handlers, and (via its blockEnded) the ToolBlockLifetime each TS tool
    // declares as its blockLifetime.
    const tsServer = x.resolve(ITypeScriptService);
    const loader = x.resolve(ConfigLoader);
    const objects = x.resolve(IObjectStore);
    const memory = x.resolve(IMemoryStore);
    const history = x.resolve(IHistoryReader);
    // The live session id, read afresh per call: ConversationSession mutates its id on /new, so the getter must
    // read it each time rather than capture it once.
    const session = x.resolve(ConversationSession);
    const runtime = x.resolve(IRuntimeOptions);
    const appLogger = x.resolve(ILogger);
    // Skill roots are replacement-only config: the whole set for the session, no built-in default.
    // Expand each to a single absolute form (~/$VAR, then resolve against cwd) so the Skill tool
    // resolves against canonical paths. An empty list resolves nothing — a valid, visibly bare state.
    const skillDirs = loader.config.skillDirs.map((d: string) => path.resolve(fs.cwd(), expandPath(d, fs)));
    const tools = createAppTools({ fs, tsServer, toolsConfig: loader.config.tools, objects, memory, history, currentSessionId: () => session.id, clock: x.resolve(Clock), tsAvailable: runtime.tsAvailable, logger: appLogger });
    return new AppToolsService(tools);
  });
  // AppToolsService is factory-built, so its cache key is the factory; alias the
  // contract through resolve() to share the one instance (a plain .to(AppToolsService)
  // would zero-arg `new` it).
  services.register(IToolProvider).to(IToolProvider, (x) => x.resolve(AppToolsService));

  // --- SDK pipeline ---
  services.register(StreamProcessor).to(StreamProcessor);
  services.register(IStreamProcessor).to(StreamProcessor);
  services.register(IToolRegistry).to(IToolRegistry, (x) => {
    const fs = x.resolve(IFileSystem);
    // Canonicalise a marked path to a single absolute form all three consumers read: expand ~/$VAR,
    // then resolve against cwd so a relative path (test1.txt) and dot segments (../a) collapse to one
    // path. Symlinks are not resolved (realpath is async and throws on not-yet-existing paths).
    const expand = (p: string) => path.resolve(fs.cwd(), expandPath(p, fs));
    return new ToolRegistry(x.resolve(IToolProvider).tools, x.resolve(ILogger), expand);
  });
  // Build-tools step: collect every distinct block lifetime the tools declared,
  // then build the generic notifier QueryRunner fires at block end. Deduped —
  // the four TS tools share one bridge, so its teardown runs once per block. The
  // tool→lifecycle link lives here, in the build step, not in a DI binding, so
  // any number of tools can participate.
  services.register(IToolBlockNotifier).to(IToolBlockNotifier, (x) => {
    const tools = x.resolve(IToolProvider).tools;
    const lifetimes = [...new Set(tools.flatMap((t) => (t.blockLifetime ? [t.blockLifetime] : [])))];
    return new ToolBlockNotifier(lifetimes);
  });
  services.register(AnthropicAuth).to(AnthropicAuth, () => new AnthropicAuth({ redirect: 'local' }));
  services.register(IMessageStreamer).to(IMessageStreamer, (x) => new AnthropicClient(x.resolve(AnthropicAuth), x.resolve(ILogger)));
  services.register(IModelCatalog).to(IModelCatalog, (x) => new ModelCatalog(x.resolve(AnthropicAuth), x.resolve(ILogger)));
  services.register(ApprovalCoordinator).to(ApprovalCoordinator);
  services.register(AccountLimitNotice).to(AccountLimitNotice);
  services.register(AccountLimitListener).to(AccountLimitNotice);
  services.register(StreamInterruptNotice).to(StreamInterruptNotice);
  services.register(StreamInterruptListener).to(StreamInterruptNotice);
  services.register(ITurnClock).to(TurnClock);
  services.register(IRequestClockListener).to(RequestClockAdapter);
  services.register(IToolsClockListener).to(ToolsClockAdapter);
  services.register(IWakeLockSpawner).to(NodeWakeLockSpawner);
  services.register(IWakeLock).to(PlatformWakeLock);
  services.register(ITurnRunner).to(TurnRunner);
  services.register(Conversation).to(Conversation);
  services.register(IDurableConfigProvider).to(DurableConfigFactory);
  services.register(SkillCatalogueTracker).to(SkillCatalogueTracker);
  services.register(CwdTracker).to(CwdTracker);
  services.register(SdkChannel).to(SdkChannel);
  services.register(ISdkMessagePublisher).to(SdkChannel);
  services.register(ConsumerChannel).to(ConsumerChannel);
  services.register(IBus).to(NatsBus);
  services.register(IWireSayInbox).to(WireSayInbox);
  services.register(IConvServicer).to(ConvServicer);
  services.register(IConvServe).to(ConvServe);
  services.register(IConvChangePublisher).to(ConvChangePublisher);
  services.register(IApprovalHolder).to(ApprovalHolder);
  services.register(IConvTelemetryProjector).to(ConvTelemetryProjector);
  services.register(QueryRunner).to(QueryRunner);
  services.register(IQueryRunner).to(QueryRunner);

  // --- contracts → concretes (decision 5) ---
  services.register(Screen).to(StdoutScreen);
  services.register(IProcessLauncher).to(NodeProcessLauncher);
  services.register(AttachmentSource).to(NodeAttachmentSource);
  services.register(SipsBridge).to(NodeSipsBridge);
  services.register(NodeSipsBridge).to(NodeSipsBridge);
  services.register(ModelSettings).to(ModelOverrides);
  services.register(ModelOverrides).to(ModelOverrides);

  // --- state stores ---
  services.register(StatusState).to(StatusState, (x) => new StatusState(path.basename(x.resolve(IFileSystem).cwd())));
  services.register(ConversationState).to(ConversationState);
  services.register(ConversationSession).to(ConversationSession);
  services.register(ISystemIdentity).to(SystemIdentity);
  services.register(EditorState).to(EditorState);
  services.register(ToolApprovalState).to(ToolApprovalState);
  services.register(CommandModeState).to(CommandModeState);
  services.register(WorkingDirectory).to(WorkingDirectory);
  services.register(TerminalState).to(TerminalState);
  services.register(PrimaryViewState).to(PrimaryViewState);
  services.register(ScrollState).to(ScrollState);
  services.register(AppModeState).to(AppModeState);
  services.register(HistoryViewState).to(HistoryViewState);

  // --- app services ---
  services.register(AuditStats).to(AuditStats);
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
  services.register(ScrollHandler).to(ScrollHandler);
  services.register(HistoryNavHandler).to(HistoryNavHandler);
  services.register(AgentMessageHandler).to(AgentMessageHandler);

  // --- views & presentations (assembled chains/maps are composition-root work) ---
  services.register(PrimaryView).to(PrimaryView);
  services.register(HistoryView).to(HistoryView);
  services.register(TerminalRenderer).to(TerminalRenderer, (x) => new TerminalRenderer(x.resolve(Screen), x.resolve(TerminalState)));
  services.register(PrimaryPresentation).to(PrimaryPresentation, (x) => {
    const editorChain: readonly InputHandler[] = [x.resolve(QuitHandler), x.resolve(ViewSelectHandler), x.resolve(ScrollHandler), x.resolve(ApprovalHandler), x.resolve(CommandKeyHandler), x.resolve(EditorHandler)];
    const streamingChain: readonly InputHandler[] = [x.resolve(QuitHandler), x.resolve(ViewSelectHandler), x.resolve(ScrollHandler), x.resolve(ApprovalHandler), x.resolve(CancelHandler)];
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
      turnClock: x.resolve(ITurnClock),
      terminalState: x.resolve(TerminalState),
      primaryViewState: x.resolve(PrimaryViewState),
      scrollState: x.resolve(ScrollState),
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
