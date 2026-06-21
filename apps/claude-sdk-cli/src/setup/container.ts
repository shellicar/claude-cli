import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { IObjectStore } from '@shellicar/claude-core/persistence/interfaces';
import { StdoutScreen } from '@shellicar/claude-core/screen';
import { AnthropicAuth, AnthropicClient, ApprovalCoordinator, Conversation, QueryRunner, StreamProcessor, ToolRegistry, TurnRunner } from '@shellicar/claude-sdk';
import { nodeFs } from '@shellicar/claude-sdk-tools/fs';
import { resolveTsServerPath, TsServerService } from '@shellicar/claude-sdk-tools/TsService';
import type { IServiceProvider } from '@shellicar/core-di-lite';
import { createServiceCollection } from '@shellicar/core-di-lite';
import { AuditWriter } from '../AuditWriter.js';
import type { Presentation } from '../app/Presentation.js';
import { PrimaryPresentation } from '../app/PrimaryPresentation.js';
import { TerminalInput } from '../app/TerminalInput.js';
import { ViewHost } from '../app/ViewHost.js';
import { ClaudeMdLoader } from '../ClaudeMdLoader.js';
import { AgentMessageHandler } from '../controller/AgentMessageHandler.js';
import { ApprovalHandler } from '../controller/ApprovalHandler.js';
import { CancelHandler } from '../controller/CancelHandler.js';
import { CommandIntentExecutor } from '../controller/CommandIntentExecutor.js';
import { COMMAND_BINDINGS_BY_CONTEXT, CommandKeyHandler } from '../controller/CommandKeyHandler.js';
import { EditorHandler } from '../controller/EditorHandler.js';
import type { InputHandler } from '../controller/InputHandler.js';
import { QuitHandler } from '../controller/QuitHandler.js';
import { GitStateMonitor } from '../GitStateMonitor.js';
import { logger } from '../logger.js';
import type { AppModeKey } from '../model/AppModeState.js';
import { AppModeState } from '../model/AppModeState.js';
import { ApprovalNotifier } from '../model/ApprovalNotifier.js';
import { CommandModeState } from '../model/CommandModeState.js';
import { ConversationSession } from '../model/ConversationSession.js';
import { ConversationState } from '../model/ConversationState.js';
import { EditorState } from '../model/EditorState.js';
import { NodeAttachmentSource } from '../model/NodeAttachmentSource.js';
import { NodeProcessLauncher } from '../model/NodeProcessLauncher.js';
import { PermissionsNoticeGate } from '../model/PermissionsNoticeGate.js';
import { PrimaryViewState } from '../model/PrimaryViewState.js';
import { StatusState } from '../model/StatusState.js';
import { TerminalState } from '../model/TerminalState.js';
import { ToolApprovalState } from '../model/ToolApprovalState.js';
import { buildPermissionMatrix } from '../permissions.js';
import { SqliteObjectStore } from '../persistence/SqliteObjectStore.js';
import { ReadLine } from '../ReadLine.js';
import { SystemPromptLoader } from '../SystemPromptLoader.js';
import { Flasher } from '../view/Flasher.js';
import { PrimaryView } from '../view/PrimaryView.js';
import { TerminalRenderer } from '../view/TerminalRenderer.js';
import type { ViewModel } from '../view/View.js';
import { AppToolsService } from './AppToolsService.js';
import { ConsumerChannel } from './ConsumerChannel.js';
import { DurableConfigFactory } from './DurableConfigFactory.js';
import { ModelOverrides } from './ModelOverrides.js';
import { SdkChannel } from './SdkChannel.js';

export interface ContainerOptions {
  configLoader: ConfigLoader<any>;
  modelOverride: string | null;
  systemFlagText: string | null;
}

export function buildContainer(options: ContainerOptions): IServiceProvider {
  const { configLoader, modelOverride, systemFlagText } = options;
  const services = createServiceCollection();

  // Resolve typescript's on-disk path once. null means typescript can't be
  // found (the SEA without the launcher-provided path): the TS server degrades
  // and the TS tools are left out, but the CLI still boots.
  const tsServerPath = resolveTsServerPath();

  // --- pre-built: passed in ---
  services.register(ConfigLoader).to(ConfigLoader, () => configLoader);

  // --- stores ---
  services.register(StatusState).to(StatusState, () => new StatusState(nodeFs));
  services.register(Conversation).to(Conversation, () => new Conversation());
  services.register(ConversationSession).to(ConversationSession, (x) => new ConversationSession(nodeFs, x.resolve(Conversation)));
  services.register(ConversationState).to(ConversationState, () => new ConversationState());
  services.register(EditorState).to(EditorState, () => new EditorState());
  services.register(ToolApprovalState).to(ToolApprovalState, () => new ToolApprovalState());
  services.register(CommandModeState).to(CommandModeState, () => new CommandModeState());
  services.register(TerminalState).to(TerminalState, () => new TerminalState());
  services.register(PrimaryViewState).to(PrimaryViewState, () => new PrimaryViewState());
  services.register(AppModeState).to(AppModeState, () => new AppModeState());

  // --- model overrides (replaces main() overrides object + inline functions) ---
  services.register(ModelOverrides).to(ModelOverrides, (x) => new ModelOverrides(modelOverride, x.resolve(StatusState)));

  // --- auth ---
  services.register(AnthropicAuth).to(AnthropicAuth, () => new AnthropicAuth({ redirect: 'local' }));
  services.register(AnthropicClient).to(AnthropicClient, (x) => {
    const auth = x.resolve(AnthropicAuth);
    const authToken = async () => {
      const credentials = await auth.getCredentials();
      return credentials.claudeAiOauth.accessToken;
    };
    return new AnthropicClient({ authToken, logger });
  });

  // --- ts server ---
  services.register(TsServerService).to(TsServerService, () => new TsServerService({ cwd: process.cwd(), tsserverPath: tsServerPath }));

  // --- persistence (Ref + PreviewEdit state survives restart) ---
  services.register(IObjectStore).to(SqliteObjectStore, (x) => {
    const db = x.resolve(DatabaseSync);
    return new SqliteObjectStore(db);
  });
  services.register(DatabaseSync).to(DatabaseSync, () => {
    const path = `${nodeFs.homedir()}/.claude/persistence.db`;
    // node:sqlite cannot open a database in a directory that does not exist.
    mkdirSync(dirname(path), { recursive: true });
    return new DatabaseSync(path);
  });

  // --- tool suite ---
  services.register(AppToolsService).to(AppToolsService, (x) => new AppToolsService(x.resolve(TsServerService), x.resolve(ConfigLoader), x.resolve(IObjectStore), tsServerPath != null));

  // --- audit ---
  services.register(AuditWriter).to(AuditWriter, () => new AuditWriter(nodeFs, `${nodeFs.homedir()}/.claude/audit`));

  // --- SDK pipeline ---
  services.register(StreamProcessor).to(StreamProcessor, () => new StreamProcessor(logger));
  services.register(ApprovalCoordinator).to(ApprovalCoordinator, () => new ApprovalCoordinator());
  services.register(SdkChannel).to(SdkChannel, () => new SdkChannel());
  services.register(ConsumerChannel).to(ConsumerChannel, () => new ConsumerChannel());

  // --- session / git ---
  services.register(GitStateMonitor).to(GitStateMonitor, () => new GitStateMonitor());
  services.register(ClaudeMdLoader).to(ClaudeMdLoader, () => new ClaudeMdLoader(nodeFs));

  // --- input infrastructure ---
  services.register(NodeAttachmentSource).to(NodeAttachmentSource, () => new NodeAttachmentSource());
  services.register(NodeProcessLauncher).to(NodeProcessLauncher, () => new NodeProcessLauncher());

  services.register(ApprovalNotifier).to(ApprovalNotifier, (x) => new ApprovalNotifier(x.resolve(ConfigLoader), x.resolve(NodeProcessLauncher)));
  services.register(PermissionsNoticeGate).to(PermissionsNoticeGate, () => new PermissionsNoticeGate(configLoader.config.permissions));

  // --- handlers ---
  services.register(CommandIntentExecutor).to(CommandIntentExecutor, (x) => new CommandIntentExecutor(x.resolve(CommandModeState), x.resolve(ConversationState), x.resolve(ConversationSession), x.resolve(NodeAttachmentSource), x.resolve(ModelOverrides)));
  services.register(QuitHandler).to(QuitHandler, (x) => new QuitHandler(() => x.resolve(TerminalRenderer).exit()));
  services.register(ApprovalHandler).to(ApprovalHandler, (x) => new ApprovalHandler(x.resolve(ToolApprovalState)));
  services.register(CommandKeyHandler).to(CommandKeyHandler, (x) => new CommandKeyHandler(x.resolve(CommandModeState), COMMAND_BINDINGS_BY_CONTEXT, x.resolve(CommandIntentExecutor)));
  services.register(CancelHandler).to(CancelHandler, (x) => new CancelHandler(() => x.resolve(ConsumerChannel).send({ type: 'cancel' })));
  services.register(EditorHandler).to(EditorHandler, (x) => new EditorHandler(x.resolve(EditorState), x.resolve(CommandModeState), x.resolve(TerminalState)));

  // --- rendering ---
  services.register(TerminalRenderer).to(TerminalRenderer, (x) => new TerminalRenderer(new StdoutScreen(), x.resolve(TerminalState)));
  services.register(PrimaryPresentation).to(PrimaryPresentation, (x) => {
    const editorChain: readonly InputHandler[] = [x.resolve(QuitHandler), x.resolve(ApprovalHandler), x.resolve(CommandKeyHandler), x.resolve(EditorHandler)];
    const streamingChain: readonly InputHandler[] = [x.resolve(QuitHandler), x.resolve(ApprovalHandler), x.resolve(CancelHandler)];
    return new PrimaryPresentation(new PrimaryView(), x.resolve(PrimaryViewState), editorChain, streamingChain);
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
      session: x.resolve(ConversationSession),
    };
    const presentations: ReadonlyMap<AppModeKey, Presentation> = new Map([['primary', x.resolve(PrimaryPresentation)]]);
    return new ViewHost(x.resolve(TerminalRenderer), model, presentations, x.resolve(AppModeState));
  });
  services.register(TerminalInput).to(TerminalInput, (x) => new TerminalInput(x.resolve(ViewHost)));
  services.register(ReadLine).to(ReadLine, (x) => new ReadLine((key) => x.resolve(TerminalInput).handle(key)));
  services.register(Flasher).to(Flasher, (x) => new Flasher(x.resolve(ToolApprovalState)));

  // --- system prompts (SYSTEM.md loader; async resolution happens at activation) ---
  services.register(SystemPromptLoader).to(SystemPromptLoader, () => new SystemPromptLoader(nodeFs));

  // --- durable config (replaces mapConfig() closure) ---
  services.register(DurableConfigFactory).to(DurableConfigFactory, (x) => new DurableConfigFactory(x.resolve(ConfigLoader), x.resolve(ModelOverrides), x.resolve(AppToolsService), x.resolve(SystemPromptLoader), systemFlagText));

  // --- query pipeline ---
  services.register(ToolRegistry).to(ToolRegistry, (x) => new ToolRegistry(x.resolve(AppToolsService).tools, logger));
  services.register(TurnRunner).to(TurnRunner, (x) => new TurnRunner(x.resolve(AnthropicClient), x.resolve(StreamProcessor), logger));
  services.register(QueryRunner).to(QueryRunner, (x) => new QueryRunner(x.resolve(TurnRunner), x.resolve(Conversation), x.resolve(ToolRegistry), x.resolve(ApprovalCoordinator), x.resolve(SdkChannel), x.resolve(DurableConfigFactory).config, logger));

  // --- agent message handler ---
  services.register(AgentMessageHandler).to(AgentMessageHandler, (x) => {
    const factory = x.resolve(DurableConfigFactory);
    return new AgentMessageHandler(logger, {
      config: factory.config,
      channel: x.resolve(ConsumerChannel),
      cwd: process.cwd(),
      store: x.resolve(AppToolsService).store,
      statusState: x.resolve(StatusState),
      notifier: x.resolve(ApprovalNotifier),
      conversationState: x.resolve(ConversationState),
      toolApprovalState: x.resolve(ToolApprovalState),
      getMatrix: () => buildPermissionMatrix(configLoader.config.permissions),
      fs: nodeFs,
    });
  });

  return services.buildProvider();
}
