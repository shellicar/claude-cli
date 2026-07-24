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
import { IHistoryReader, IHistorySweeper, IHistoryWriter } from '@shellicar/claude-core/history/interfaces';
import { SqliteHistoryEngine } from '@shellicar/claude-core/history/SqliteHistoryEngine';
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
  IConversation,
  IDisabledToolsProvider,
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
import { IEnvProvider, IRulesConfigProvider, RulesConfigGate } from '@shellicar/claude-sdk-tools/ExecV3';
import { NodeFileSystem } from '@shellicar/claude-sdk-tools/fs';
import { ITsServerClient, ITsServerOptions, ITypeScriptService, TsServerBridge, TsServerClient } from '@shellicar/claude-sdk-tools/TsService';
import { createServiceCollection, type IServiceProvider } from '@shellicar/core-di-lite';
import { AuditStats } from '../AuditStats.js';
import { AuditWriter } from '../AuditWriter.js';
import { AgentPresence, IAgentPresence } from '../agent/AgentPresence.js';
import { AgentServe, IAgentServe } from '../agent/AgentServe.js';
import { AgentServicer, IAgentServicer } from '../agent/AgentServicer.js';
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
import { AppModeState, type AppModeKey, IAppModeState } from '../model/AppModeState.js';
import { ApprovalNotifier } from '../model/ApprovalNotifier.js';
import { AttachmentSource } from '../model/AttachmentSource.js';
import { RequestClockAdapter, ToolsClockAdapter } from '../model/ClockListeners.js';
import { CommandModeState, ICommandModeState } from '../model/CommandModeState.js';
import { ConversationSession, IConversationSession } from '../model/ConversationSession.js';
import { ConversationState, IConversationState } from '../model/ConversationState.js';
import { EditorState, IEditorState } from '../model/EditorState.js';
import { HistoryViewState, IHistoryViewState } from '../model/HistoryViewState.js';
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
import { IPrimaryViewState, PrimaryViewState } from '../model/PrimaryViewState.js';
import { IScrollState, ScrollState } from '../model/ScrollState.js';
import { StatusState } from '../model/StatusState.js';
import { StreamInterruptNotice } from '../model/StreamInterruptNotice.js';
import { SystemIdentity } from '../model/SystemIdentity.js';
import { ITerminalState, TerminalState } from '../model/TerminalState.js';
import { IToolApprovalState, ToolApprovalState } from '../model/ToolApprovalState.js';
import { TurnClock } from '../model/TurnClock.js';
import { IWorkingDirectory, WorkingDirectory } from '../model/WorkingDirectory.js';
import { DatabaseFactory } from '../persistence/DatabaseFactory.js';
import { IDatabaseOptions } from '../persistence/IDatabaseOptions.js';
import { SqliteHistorySweeper } from '../persistence/SqliteHistorySweeper.js';
import { SqliteMemoryEngine } from '../persistence/SqliteMemoryEngine.js';
import { SqliteMemoryStore } from '../persistence/SqliteMemoryStore.js';
import { SqliteObjectStore } from '../persistence/SqliteObjectStore.js';
import { ISqliteSessionStore, SqliteSessionStore } from '../persistence/SqliteSessionStore.js';
import { ReadLine } from '../ReadLine.js';
import { SystemPromptLoader } from '../SystemPromptLoader.js';
import { EnvProvider } from '../secrets/EnvProvider.js';
import { ISecrets, Secrets } from '../secrets/Secrets.js';
import { Flasher } from '../view/Flasher.js';
import { HistoryView } from '../view/HistoryView.js';
import { PrimaryView } from '../view/PrimaryView.js';
import { TerminalRenderer } from '../view/TerminalRenderer.js';
import type { ViewModel } from '../view/View.js';
import { AppToolsService } from './AppToolsService.js';
import { ConfigDisabledToolsProvider } from './ConfigDisabledToolsProvider.js';
import { ConfigRulesConfigProvider, IRulesConfigNotifier, RulesConfigWatchHandle, readToolsRaw } from './ConfigRulesConfigProvider.js';
import { ConsumerChannel } from './ConsumerChannel.js';
import { CwdTracker } from './CwdTracker.js';
import { DurableConfigFactory } from './DurableConfigFactory.js';
import { GitMemoryEnvironmentProvider } from './GitMemoryEnvironmentProvider.js';
import { IRuntimeOptions } from './IRuntimeOptions.js';
import { ModelOverrides } from './ModelOverrides.js';
import { SdkChannel } from './SdkChannel.js';
import { IShutdownCoordinator, ShutdownCoordinator } from './ShutdownCoordinator.js';
import { SkillCatalogueTracker } from './SkillCatalogueTracker.js';
import z from 'zod';

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
  services.register(IConfigOptions).using(() => options.configOptions).asSelf();
  services.register(IRuntimeOptions).using(() => options.runtimeOptions).asSelf();
  services.register(ITsServerOptions).using(() => options.tsServerOptions).asSelf();
  services.register(IDatabaseOptions).using(() => options.databaseOptions).asSelf();

  // --- cross-cutting providers + logger + filesystem (decision 4) ---
  services.register(ILogger).using(() => logger).asSelf();
  services.register(NodeFileSystem).as(IFileSystem);
  services.register(Clock).using(() => Clock.systemDefaultZone()).asSelf();
  services.register(TimeoutSleepProvider).as(ISleepProvider);
  services.register(MathRandomProvider).as(IRandomProvider);

  // --- config: holder (eager read) + reloader + watch-init factory ---
  services.register(NodeConfigFileReader).as(IConfigFileReader);
  services.register(NodeDirectoryWatcher).as(IConfigWatcher);
  services.register(ConfigLoader).using([IConfigOptions, IConfigFileReader, IFileSystem], (configOptions, fileReader, fileSystem) => new ConfigLoader(readConfig(configOptions, fileReader, fileSystem))).asSelf();
  services.register(ConfigReloader).asSelf();
  services.register(ConfigWatchHandle).using([IConfigWatcher, IConfigOptions, ConfigReloader], (watcher, opts, reloader) => watcher.watch(opts.paths, () => reloader.scheduleReload())).asSelf();
  // Isolated from the whole-document reload above: tools.rules/tools.blockedCommands validate and
  // watch independently, so a broken rules edit pins only this section to its last-good value
  // instead of blocking every other, unrelated config fix in the same reload. RulesConfigGate is a
  // registered service, not a value manually `new`'d inside ConfigRulesConfigProvider — its factory
  // needs a computed initial value (the raw tools section), the same shape as PermissionsNoticeGate
  // above. Fail-fast-at-boot happens here, the moment this factory runs on first resolve.
  services.register(RulesConfigGate).using([IConfigOptions, IConfigFileReader], (opts, reader) => new RulesConfigGate(readToolsRaw(opts.paths, reader))).asSelf();
  // IRulesConfigProvider (rules/blockedCommands, read by ExecV3) and IRulesConfigNotifier
  // (refresh/onNotice, driven by main.ts and the watch below) are two narrow interfaces — ISP —
  // over the one ConfigRulesConfigProvider instance below. One register() call, two faces: v5's
  // shared-identity-per-call guarantee is what makes both resolve to the same instance. No consumer
  // outside this composition root ever depends on the concrete class.
  services.register(ConfigRulesConfigProvider).as(IRulesConfigProvider).as(IRulesConfigNotifier);
  // The watch itself is a distinct registered value, the same shape as ConfigWatchHandle above.
  services.register(RulesConfigWatchHandle).using([IConfigWatcher, IConfigOptions, IRulesConfigNotifier], (watcher, opts, notifier) => watcher.watch(opts.paths, () => notifier.refresh())).asSelf();

  // --- persistence (decision 10/11) ---
  services.register(DatabaseFactory).asSelf();
  services.register(IObjectStore).using([DatabaseFactory, ConfigLoader], (factory, loader) => new SqliteObjectStore(factory.getDatabase(loader.config.persistence.database))).asSelf();

  // --- memory (sibling of IObjectStore) ---
  // The store and provider are @dependsOn classes the container resolves with a bare `.as(Identifier)`.
  // Only the engine needs a factory: its db is not a token, and the db-file selection from tenantId
  // is configuration, which belongs here. The opened db is handed to the engine, which runs its own
  // DDL/migrations on it in the constructor (eager init).
  services.register(GitMemoryEnvironmentProvider).as(IMemoryEnvironmentProvider);
  services.register(SqliteMemoryEngine).using([ConfigLoader, DatabaseFactory, Clock, ILogger], (loader, factory, clock, log) => {
    const tenantId = loader.config.memory.tenantId;
    const db = factory.getDatabase(tenantId == null ? 'memory.db' : `memory.${tenantId}.db`);
    return new SqliteMemoryEngine(db, clock, log);
  }).asSelf();
  services.register(SqliteMemoryStore).as(IMemoryStore);

  // --- session store (sibling of IObjectStore) ---
  // Owns its own database file (`sessions.db`); the opened db is handed to the store, which runs its migrations on
  // it in the constructor (eager init), matching the memory-engine wiring above.
  services.register(SqliteSessionStore).using([DatabaseFactory, ILogger], (factory, log) => new SqliteSessionStore(factory.getDatabase('sessions.db'), log)).asSelf().as(ISqliteSessionStore);

  // --- history index (sibling of the memory store) ---
  // The engine plays both the read and write seams; each interface resolves to the one engine. It owns `history.db`;
  // the opened db is handed to the engine, which runs its migrations on it in the constructor (eager init).
  services.register(SqliteHistoryEngine).using([DatabaseFactory, ILogger], (factory, log) => new SqliteHistoryEngine(factory.getDatabase('history.db'), log)).asSelf();
  services.register(IHistoryReader).using([SqliteHistoryEngine], (engine) => engine).asSelf();
  services.register(IHistoryWriter).using([SqliteHistoryEngine], (engine) => engine).asSelf();
  // The dedup sweep runs over the same `history.db`; it shares the engine's connection (the factory memoises one per
  // name) and the sweep tables it uses are migration 1.1, which the engine applies when it is resolved above.
  services.register(IHistorySweeper).using([DatabaseFactory, Clock], (factory, clock) => new SqliteHistorySweeper(factory.getDatabase('history.db'), clock)).asSelf();

  // --- ts server ---
  // Class 1: the anti-corruption wire client, cycled per tool block.
  services.register(TsServerClient).as(ITsServerClient);
  // Class 2: the model-facing bridge, a plain @dependsOn class registered under
  // ITypeScriptService — the live contract every consumer resolves. Its
  // blockEnded() reaches the pipeline NOT through a DI binding but by being
  // declared as each TS tool's blockLifetime (see createAppTools).
  services.register(TsServerBridge).as(ITypeScriptService);

  // --- tool suite (createAppTools is composition-root work) ---
  // AppToolsService is factory-built and shares its identity with IToolProvider from this one
  // register() call (v5's shared-identity-per-call guarantee), so both resolve to the same instance.
  services
    .register(AppToolsService)
    .using(
      [IFileSystem, ITypeScriptService, ConfigLoader, IObjectStore, IMemoryStore, IHistoryReader, ConversationSession, IRuntimeOptions, ILogger, ISecrets, IEnvProvider, IRulesConfigProvider, Clock],
      (fs, tsServer, loader, objects, memory, history, session, runtime, appLogger, secrets, envProvider, rulesProvider, clock) => {
        // Skill roots are replacement-only config: the whole set for the session, no built-in default.
        // Expand each to a single absolute form (~/$VAR, then resolve against cwd) so the Skill tool
        // resolves against canonical paths. An empty list resolves nothing — a valid, visibly bare state.
        const skillDirs = loader.config.skillDirs.map((d: string) => path.resolve(fs.cwd(), expandPath(d, fs)));
        // The live session id, read afresh per call: ConversationSession mutates its id on /new, so the getter must
        // read it each time rather than capture it once.
        const tools = createAppTools({
          fs,
          tsServer,
          toolsConfig: loader.config.tools,
          rulesProvider,
          objects,
          memory,
          history,
          currentSessionId: () => session.id,
          clock,
          tsAvailable: runtime.tsAvailable,
          logger: appLogger,
          skillDirs,
          secrets,
          envProvider,
          getAzAccounts: () => loader.config.az.accounts,
        });
        return new AppToolsService(tools);
      },
    )
    .asSelf()
    .as(IToolProvider);

  // --- SDK pipeline ---
  // StreamProcessor and IStreamProcessor share identity from this one register() call.
  services.register(StreamProcessor).asSelf().as(IStreamProcessor);
  services.register(ConfigDisabledToolsProvider).as(IDisabledToolsProvider);
  services.register(IToolRegistry).using([IFileSystem, IToolProvider, ILogger, IDisabledToolsProvider], (fs, toolProvider, log, disabledToolsProvider) => {
    // Canonicalise a marked path to a single absolute form all three consumers read: expand ~/$VAR,
    // then resolve against cwd so a relative path (test1.txt) and dot segments (../a) collapse to one
    // path. Symlinks are not resolved (realpath is async and throws on not-yet-existing paths).
    const expand = (p: string) => path.resolve(fs.cwd(), expandPath(p, fs));
    return new ToolRegistry(toolProvider.tools, log, expand, disabledToolsProvider);
  }).asSelf();
  // Build-tools step: collect every distinct block lifetime the tools declared,
  // then build the generic notifier QueryRunner fires at block end. Deduped —
  // the four TS tools share one bridge, so its teardown runs once per block. The
  // tool→lifecycle link lives here, in the build step, not in a DI binding, so
  // any number of tools can participate.
  services.register(IToolBlockNotifier).using([IToolProvider], (toolProvider) => {
    const tools = toolProvider.tools;
    const lifetimes = [...new Set(tools.flatMap((t) => (t.blockLifetime ? [t.blockLifetime] : [])))];
    return new ToolBlockNotifier(lifetimes);
  }).asSelf();
  services.register(AnthropicAuth).using(() => new AnthropicAuth({ redirect: 'local' })).asSelf();
  services.register(IMessageStreamer).using([AnthropicAuth, ILogger], (auth, log) => new AnthropicClient(auth, log)).asSelf();
  services.register(IModelCatalog).using([AnthropicAuth, ILogger], (auth, log) => new ModelCatalog(auth, log)).asSelf();
  services.register(ApprovalCoordinator).asSelf();
  // AccountLimitNotice and AccountLimitListener share identity from this one register() call.
  services.register(AccountLimitNotice).asSelf().as(AccountLimitListener);
  // StreamInterruptNotice and StreamInterruptListener share identity from this one register() call.
  services.register(StreamInterruptNotice).asSelf().as(StreamInterruptListener);
  services.register(TurnClock).as(ITurnClock);
  services.register(RequestClockAdapter).as(IRequestClockListener);
  services.register(ToolsClockAdapter).as(IToolsClockListener);
  services.register(NodeWakeLockSpawner).as(IWakeLockSpawner);
  services.register(PlatformWakeLock).as(IWakeLock);
  services.register(TurnRunner).as(ITurnRunner);
  services.register(Conversation).asSelf().as(IConversation);
  services.register(DurableConfigFactory).as(IDurableConfigProvider);
  services.register(SkillCatalogueTracker).asSelf();
  services.register(CwdTracker).asSelf();
  // SdkChannel and ISdkMessagePublisher share identity from this one register() call.
  services.register(SdkChannel).asSelf().as(ISdkMessagePublisher);
  services.register(ConsumerChannel).asSelf();
  services.register(NatsBus).as(IBus);
  services.register(WireSayInbox).as(IWireSayInbox);
  services.register(ConvServicer).as(IConvServicer);
  services.register(ConvServe).as(IConvServe);
  services.register(ConvChangePublisher).as(IConvChangePublisher);
  services.register(ApprovalHolder).as(IApprovalHolder);
  services.register(AgentPresence).as(IAgentPresence);
  services.register(AgentServicer).as(IAgentServicer);
  services.register(AgentServe).as(IAgentServe);
  services.register(Secrets).as(ISecrets);
  services.register(EnvProvider).as(IEnvProvider);
  services.register(ConvTelemetryProjector).as(IConvTelemetryProjector);
  // QueryRunner and IQueryRunner share identity from this one register() call.
  services.register(QueryRunner).asSelf().as(IQueryRunner);

  // --- contracts → concretes (decision 5) ---
  services.register(StdoutScreen).as(Screen);
  // NodeProcessLauncher and IProcessLauncher share identity from this one register() call
  // (previously two separate registrations under the old grammar).
  services.register(NodeProcessLauncher).asSelf().as(IProcessLauncher);
  // NodeAttachmentSource and AttachmentSource share identity from this one register() call.
  services.register(NodeAttachmentSource).asSelf().as(AttachmentSource);
  // NodeSipsBridge and SipsBridge share identity from this one register() call.
  services.register(NodeSipsBridge).asSelf().as(SipsBridge);
  // ModelOverrides and ModelSettings share identity from this one register() call.
  services.register(ModelOverrides).asSelf().as(ModelSettings);

  // --- state stores ---
  services.register(StatusState).using([IFileSystem], (fs) => new StatusState(path.basename(fs.cwd()))).asSelf();
  services.register(ConversationState).asSelf().as(IConversationState);
  services.register(ConversationSession).asSelf().as(IConversationSession);
  services.register(SystemIdentity).as(ISystemIdentity);
  services.register(EditorState).asSelf().as(IEditorState);
  services.register(ToolApprovalState).asSelf().as(IToolApprovalState);
  services.register(CommandModeState).asSelf().as(ICommandModeState);
  services.register(WorkingDirectory).asSelf().as(IWorkingDirectory);
  services.register(TerminalState).asSelf().as(ITerminalState);
  services.register(PrimaryViewState).asSelf().as(IPrimaryViewState);
  services.register(ScrollState).asSelf().as(IScrollState);
  services.register(AppModeState).asSelf().as(IAppModeState);
  services.register(HistoryViewState).asSelf().as(IHistoryViewState);

  // --- app services ---
  services.register(AuditStats).asSelf();
  services.register(AuditWriter).asSelf();
  services.register(ClaudeMdLoader).asSelf();
  services.register(SystemPromptLoader).asSelf();
  services.register(GitStateMonitor).asSelf();
  services.register(ApprovalNotifier).asSelf();
  services.register(PermissionsNoticeGate).using([ConfigLoader], (loader) => new PermissionsNoticeGate(loader.config.permissions)).asSelf();

  // --- handlers ---
  services.register(CommandIntentExecutor).asSelf();
  services.register(ShutdownCoordinator).as(IShutdownCoordinator);
  // QuitHandler may not import the setup layer (controller ⇛ setup), so the
  // shutdown request is wired here as a closure rather than field-injected.
  // It requests the coordinator, never exits directly — see QuitHandler.
  services.register(QuitHandler).using([IShutdownCoordinator], (coordinator) => new QuitHandler(() => coordinator.request('quit'))).asSelf();
  services.register(ApprovalHandler).asSelf();
  services.register(CommandKeyHandler).asSelf();
  services.register(CancelHandler).asSelf();
  services.register(EditorHandler).asSelf();
  services.register(ViewSelectHandler).asSelf();
  services.register(ScrollHandler).asSelf();
  services.register(HistoryNavHandler).asSelf();
  services.register(AgentMessageHandler).asSelf();

  // --- views & presentations (assembled chains/maps are composition-root work) ---
  services.register(PrimaryView).asSelf();
  services.register(HistoryView).asSelf();
  services.register(TerminalRenderer).using([Screen, TerminalState], (screen, terminalState) => new TerminalRenderer(screen, terminalState)).asSelf();
  services
    .register(PrimaryPresentation)
    .using(
      [QuitHandler, ViewSelectHandler, ScrollHandler, ApprovalHandler, CommandKeyHandler, EditorHandler, CancelHandler, PrimaryView, PrimaryViewState],
      (quit, viewSelect, scroll, approval, commandKey, editor, cancel, primaryView, primaryViewState) => {
        const editorChain: readonly InputHandler[] = [quit, viewSelect, scroll, approval, commandKey, editor];
        const streamingChain: readonly InputHandler[] = [quit, viewSelect, scroll, approval, commandKey, cancel];
        return new PrimaryPresentation(primaryView, primaryViewState, editorChain, streamingChain);
      },
    )
    .asSelf();
  services.register(HistoryPresentation).using([QuitHandler, ViewSelectHandler, HistoryNavHandler, HistoryView], (quit, viewSelect, historyNav, historyView) => {
    const chain: readonly InputHandler[] = [quit, viewSelect, historyNav];
    return new HistoryPresentation(historyView, chain);
  }).asSelf();
  services
    .register(ViewHost)
    .using(
      [
        ConversationState,
        EditorState,
        ToolApprovalState,
        CommandModeState,
        StatusState,
        ITurnClock,
        TerminalState,
        PrimaryViewState,
        ScrollState,
        HistoryViewState,
        AppModeState,
        ConversationSession,
        ConfigLoader,
        TerminalRenderer,
        PrimaryPresentation,
        HistoryPresentation,
      ],
      (conversationState, editorState, toolApprovalState, commandModeState, statusState, turnClock, terminalState, primaryViewState, scrollState, historyViewState, appModeState, session, configLoader, terminalRenderer, primaryPresentation, historyPresentation) => {
        const model: ViewModel = {
          conversationState,
          editorState,
          toolApprovalState,
          commandModeState,
          statusState,
          turnClock,
          terminalState,
          primaryViewState,
          scrollState,
          historyViewState,
          appModeState,
          session,
          configLoader,
        };
        const presentations: ReadonlyMap<AppModeKey, Presentation> = new Map<AppModeKey, Presentation>([
          ['primary', primaryPresentation],
          ['history', historyPresentation],
        ]);
        return new ViewHost(terminalRenderer, model, presentations, appModeState);
      },
    )
    .asSelf();
  services.register(TerminalInput).asSelf();
  services.register(ReadLine).using([TerminalInput, ConfigLoader], (input, loader) => new ReadLine(
    (key) => input.handle(key),
    () => loader.config.input.escFastPath,
  )).asSelf();
  services.register(Flasher).using([ToolApprovalState], (toolApprovalState) => new Flasher(toolApprovalState)).asSelf();

  return services.buildProvider();
}
