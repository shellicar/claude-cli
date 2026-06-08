import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { BetaToolSearchToolBm25_20251119, BetaToolSearchToolRegex20251119 } from '@anthropic-ai/sdk/resources/beta.mjs';
import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { NodeConfigFileReader } from '@shellicar/claude-core/Config/NodeConfigFileReader';
import { NodeConfigWatcher } from '@shellicar/claude-core/Config/NodeConfigWatcher';
import { StdoutScreen } from '@shellicar/claude-core/screen';
import { AnthropicAuth, AnthropicBeta, AnthropicClient, ApprovalCoordinator, type BetaToolUnion, CacheTtl, type ConsumerMessage, ControlChannel, Conversation, type DurableConfig, QueryRunner, type SdkMessage, StreamProcessor, type ThinkingEffort, ToolRegistry, TurnRunner } from '@shellicar/claude-sdk';
import { nodeFs } from '@shellicar/claude-sdk-tools/fs';
import { TsServerService } from '@shellicar/claude-sdk-tools/TsService';
import { z } from 'zod';
import { AuditWriter } from '../AuditWriter.js';
import type { Presentation } from '../app/Presentation.js';
import { PrimaryPresentation } from '../app/PrimaryPresentation.js';
import { TerminalInput } from '../app/TerminalInput.js';
import { ViewHost } from '../app/ViewHost.js';
import { buildAtuTransform } from '../buildAtuTransform.js';
import { buildServerTools } from '../buildServerTools.js';
import { ClaudeMdLoader } from '../ClaudeMdLoader.js';
import { CONFIG_PATH, LOCAL_CONFIG_PATH } from '../cli-config/consts.js';
import { formatEffectiveConfig } from '../cli-config/formatEffectiveConfig.js';
import { initConfig } from '../cli-config/initConfig.js';
import { parseConfigOverride } from '../cli-config/parseConfigOverride.js';
import { sdkConfigSchema } from '../cli-config/schema.js';
import { AgentMessageHandler } from '../controller/AgentMessageHandler.js';
import { ApprovalHandler } from '../controller/ApprovalHandler.js';
import { CancelHandler } from '../controller/CancelHandler.js';
import { CommandIntentExecutor } from '../controller/CommandIntentExecutor.js';
import { COMMAND_BINDINGS_BY_CONTEXT, CommandKeyHandler } from '../controller/CommandKeyHandler.js';
import { EditorHandler } from '../controller/EditorHandler.js';
import type { InputHandler } from '../controller/InputHandler.js';
import { QuitHandler } from '../controller/QuitHandler.js';
import { createAppTools } from '../createAppTools.js';
import { decodePromptEscapes } from '../decodePromptEscapes.js';
import { GitStateMonitor } from '../GitStateMonitor.js';
import { printUsage, printVersion, printVersionInfo, startupBannerText } from '../help.js';
import { logger } from '../logger.js';
import { type AppModeKey, AppModeState } from '../model/AppModeState.js';
import { ApprovalNotifier } from '../model/ApprovalNotifier.js';
import { buildSubmitText } from '../model/buildSubmitText.js';
import { CommandModeState } from '../model/CommandModeState.js';
import { ConversationSession } from '../model/ConversationSession.js';
import { ConversationState } from '../model/ConversationState.js';
import { EditorState } from '../model/EditorState.js';
import type { ModelSettings } from '../model/ModelSettings.js';
import { NodeAttachmentSource } from '../model/NodeAttachmentSource.js';
import { NodeProcessLauncher } from '../model/NodeProcessLauncher.js';
import { PrimaryViewState } from '../model/PrimaryViewState.js';
import { PermissionAction, type PermissionConfig } from '../permissions.js';
import { StatusState } from '../model/StatusState.js';
import { TerminalState } from '../model/TerminalState.js';
import { ToolApprovalState } from '../model/ToolApprovalState.js';
import { ReadLine } from '../ReadLine.js';
import { replayHistory } from '../replayHistory.js';
import { buildRunAgentInput, runAgent, type UserInput } from '../runAgent.js';
import { systemPrompts } from '../systemPrompts.js';
import { flushSealedToScroll } from '../view/flushSealedToScroll.js';
import { PrimaryView } from '../view/PrimaryView.js';
import { TerminalRenderer } from '../view/TerminalRenderer.js';
import type { ViewModel } from '../view/View.js';

process.title = 'claude-sdk-cli';

if (process.argv.includes('-?')) {
  // biome-ignore lint/suspicious/noConsole: CLI --help output before app starts
  printUsage(console.log);
  process.exit(0);
}

let parsed: ReturnType<typeof parseArgs>;
try {
  parsed = parseArgs({
    options: {
      version: { type: 'boolean', short: 'v', default: false },
      'version-info': { type: 'boolean', default: false },
      'init-config': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      file: { type: 'string', multiple: true },
      name: { type: 'string' },
      model: { type: 'string' },
      prompt: { type: 'string' },
      resume: { type: 'string' },
      config: { type: 'string' },
      'no-resume': { type: 'boolean', default: false },
    },
    strict: true,
  });
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n\n`);
  printUsage((line) => process.stderr.write(`${line}\n`));
  process.exit(1);
}
const { values } = parsed;

if (values.version) {
  // biome-ignore lint/suspicious/noConsole: CLI --version output before app starts
  printVersion(console.log);
  process.exit(0);
}

if (values['version-info']) {
  // biome-ignore lint/suspicious/noConsole: CLI --version-info output before app starts
  printVersionInfo(console.log);
  process.exit(0);
}

if (values['init-config']) {
  // biome-ignore lint/suspicious/noConsole: CLI --init-config output before app starts
  initConfig(console.log);
  process.exit(0);
}

if (values.help) {
  // biome-ignore lint/suspicious/noConsole: CLI --help output before app starts
  printUsage(console.log);
  process.exit(0);
}

if (!process.stdin.isTTY) {
  process.stderr.write('stdin is not a terminal. Run interactively.\n');
  process.exit(1);
}

const initialFilePaths = Array.isArray(values.file) ? (values.file as string[]).map((p) => resolve(p.replace(/^~(?=\/|$)/, process.env.HOME ?? ''))) : [];
const initialPrompt = typeof values.prompt === 'string' ? values.prompt : null;
const decodedPrompt = initialPrompt != null ? decodePromptEscapes(initialPrompt) : null;
const noResume = values['no-resume'] === true;
const sessionName = typeof values.name === 'string' ? values.name : null;
const modelOverride = typeof values.model === 'string' ? values.model : null;
const resumeId = typeof values.resume === 'string' ? values.resume : null;
if (resumeId != null) {
  const parsed = z.string().uuid().safeParse(resumeId);
  if (!parsed.success) {
    process.stderr.write(`Invalid --resume value: expected a UUID, got "${resumeId}"\n`);
    process.exit(1);
  }
}

let configOverride: Record<string, unknown> | undefined;
const configArg = typeof values.config === 'string' ? values.config : null;
if (configArg != null) {
  try {
    configOverride = parseConfigOverride(configArg);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}

async function buildInitialInput(text: string, filePaths: readonly string[]): Promise<UserInput> {
  if (filePaths.length === 0) {
    return { text, images: [] };
  }
  const attachments: { kind: 'file'; path: string; fileType: 'file' | 'dir' | 'missing'; sizeBytes?: number }[] = [];
  for (const filePath of filePaths) {
    let fileType: 'file' | 'dir' | 'missing' = 'missing';
    let sizeBytes: number | undefined;
    try {
      const fileInfo = await stat(filePath);
      if (fileInfo.isDirectory()) {
        fileType = 'dir';
      } else {
        fileType = 'file';
        sizeBytes = fileInfo.size;
      }
    } catch {
      fileType = 'missing';
    }
    attachments.push({ kind: 'file', path: filePath, fileType, sizeBytes });
  }
  return {
    text: buildSubmitText(text, attachments),
    images: [],
  };
}

const main = async () => {
  const auth = new AnthropicAuth({ redirect: 'local' });
  await auth.getCredentials();
  const authToken = async () => {
    const credentials = await auth.getCredentials();
    return credentials.claudeAiOauth.accessToken;
  };

  const statusState = new StatusState(nodeFs);
  const conversation = new Conversation();
  const session = new ConversationSession(nodeFs, conversation);
  if (resumeId != null) {
    await session.resume(resumeId);
  } else if (initialFilePaths.length > 0 || initialPrompt != null || noResume) {
    await session.startFresh();
  } else {
    await session.load();
  }
  if (sessionName != null) {
    statusState.setSessionName(sessionName);
  }
  // Stores — two axes: appModeState (presentation), primaryViewState (turn phase)
  const conversationState = new ConversationState();
  const editorState = new EditorState();
  const toolApprovalState = new ToolApprovalState();
  const commandModeState = new CommandModeState();
  const terminalState = new TerminalState();
  const primaryViewState = new PrimaryViewState();
  const appModeState = new AppModeState();

  const model: ViewModel = {
    conversationState,
    editorState,
    toolApprovalState,
    commandModeState,
    statusState,
    terminalState,
    primaryViewState,
    session,
  };

  // Terminal output
  using renderer = new TerminalRenderer(new StdoutScreen(), terminalState);

  let turnInProgress = false;
  const configLoader = new ConfigLoader({
    schema: sdkConfigSchema,
    paths: [CONFIG_PATH, LOCAL_CONFIG_PATH],
    reader: new NodeConfigFileReader(),
    watcher: new NodeConfigWatcher(),
    fs: nodeFs,
    // Hook commands may be written as `~`, `$HOME`, or config-relative paths;
    // the loader resolves them per-source so a relative path always refers to
    // the directory of the file it was authored in.
    pathFields: [['hooks', 'approvalNotify', 'command']],
    overrides: configOverride === undefined ? undefined : { origin: ':parameters:', raw: configOverride },
    logger,
  });
  configLoader.load();

  // Mutable override slot. Seeded from --model at launch; command mode mutates
  // thinking and effort per-session without writing to the config file.
  const overrides: {
    model: string | null;
    thinking: 'on' | 'off' | null;
    effort: ThinkingEffort | null;
  } = {
    model: modelOverride,
    thinking: null,
    effort: null,
  };

  // Single resolver for the effective model. Override beats config-file value.
  // Every model-read site (mapConfig, every setModel call, the onChange callback)
  // routes through this function, so a mutation to overrides.model is visible on
  // the next read without further wiring.
  const getEffectiveModel = (): string => overrides.model ?? configLoader.config.model;

  // Thinking: null → read config; 'on' → true; 'off' → false.
  const getEffectiveThinkingEnabled = (): boolean => {
    if (overrides.thinking === 'on') {
      return true;
    }
    if (overrides.thinking === 'off') {
      return false;
    }
    return configLoader.config.thinking.enabled;
  };

  // Effort: null → read config; any ThinkingEffort → use it.
  const getEffectiveEffort = (): ThinkingEffort => overrides.effort ?? configLoader.config.thinking.effort;

  // Cycle order from the locked design.
  const THINKING_CYCLE = [null, 'on', 'off'] as const;
  const EFFORT_CYCLE: (ThinkingEffort | null)[] = [null, 'max', 'xhigh', 'high', 'medium', 'low'];

  const cycleThinkingOverride = (): void => {
    const idx = THINKING_CYCLE.indexOf(overrides.thinking);
    overrides.thinking = THINKING_CYCLE[(idx + 1) % THINKING_CYCLE.length];
    statusState.setThinkingOverride(overrides.thinking);
  };

  const cycleEffortOverride = (): void => {
    const idx = EFFORT_CYCLE.indexOf(overrides.effort);
    overrides.effort = EFFORT_CYCLE[(idx + 1) % EFFORT_CYCLE.length] ?? null;
    statusState.setEffortOverride(overrides.effort);
  };

  // The model sub-mode drives these through the command executor;
  // setThinkingOverride / setEffortOverride emit change, so the host re-renders.
  const modelSettings: ModelSettings = {
    cycleThinking: cycleThinkingOverride,
    cycleEffort: cycleEffortOverride,
  };

  configLoader.onChange((config) => {
    logger.info('config reloaded', { model: config.model });
    if (!turnInProgress) {
      statusState.setModel(getEffectiveModel(), overrides.model != null);
      statusState.setShowConversationId(config.statusBar.showConversationId);
      // setModel/setShowConversationId emit; the host re-renders.
    }
  });
  configLoader.start();

  const cwd = process.cwd();
  const tsServer = new TsServerService({ cwd });
  await tsServer.start();

  const cleanup = () => {
    tsServer.stop();
    configLoader.dispose();
    renderer.exit();
    process.exit(0);
  };
  let sigintReceived = false;
  process.on('SIGINT', () => {
    if (sigintReceived) {
      process.exit(1);
    }
    sigintReceived = true;
    cleanup();
  });
  process.on('SIGTERM', cleanup);
  process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
    logger.error('uncaughtException', err);
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandledRejection', reason);
  });

  // --- SDK blocks (constructed once, reused for every query) ---

  const client = new AnthropicClient({ authToken, logger });

  const auditDir = `${nodeFs.homedir()}/.claude/audit`;
  const auditWriter = new AuditWriter(nodeFs, auditDir);
  client.on('finalMessage', (msg) => auditWriter.write(session.id, msg));

  const processor = new StreamProcessor(logger);
  const approval = new ApprovalCoordinator();

  // Per-query abort controller. Mutated before each query so the long-lived
  // channel listener can reach the current controller.
  let currentAbortController: AbortController | null = null;

  const sdkChannel = new ControlChannel<SdkMessage>();
  const consumerChannel = new ControlChannel<ConsumerMessage>();
  consumerChannel.subscribe(async (msg) => {
    const outcome = approval.handle(msg);
    // A tool-cancel must NOT abort the query controller: the delivery turn
    // reuses it to send the cancellation tool_result to the model. Only a
    // query-cancel (model streaming, or a second ESC during a tool) aborts it.
    if (outcome === 'query_cancel' && currentAbortController) {
      currentAbortController.abort();
    }
  });

  // Input handlers (one concern each; intent execution behind an injected AttachmentSource)
  const attachmentSource = new NodeAttachmentSource();
  const commandExecutor = new CommandIntentExecutor(commandModeState, conversationState, session, attachmentSource, modelSettings);
  const quitHandler = new QuitHandler(() => renderer.exit());
  const approvalHandler = new ApprovalHandler(toolApprovalState);
  const commandKeyHandler = new CommandKeyHandler(commandModeState, COMMAND_BINDINGS_BY_CONTEXT, commandExecutor);
  const cancelHandler = new CancelHandler(() => consumerChannel.send({ type: 'cancel' }));
  const editorHandler = new EditorHandler(editorState, commandModeState, terminalState);

  // Primary presentation: PrimaryView + the two phase chains (decision 5 gating by composition)
  const editorChain: readonly InputHandler[] = [quitHandler, approvalHandler, commandKeyHandler, editorHandler];
  const streamingChain: readonly InputHandler[] = [quitHandler, approvalHandler, cancelHandler];
  const primaryPresentation = new PrimaryPresentation(new PrimaryView(), primaryViewState, editorChain, streamingChain);

  const presentations: ReadonlyMap<AppModeKey, Presentation> = new Map([['primary', primaryPresentation]]);

  using host = new ViewHost(renderer, model, presentations, appModeState);

  const terminalInput = new TerminalInput(host);
  using _ = new ReadLine((key) => terminalInput.handle(key));

  renderer.enter();
  host.renderNow();

  // Forward stream events to sdkChannel. AgentMessageHandler subscribes
  // to sdkChannel to receive all events.
  processor.on('message_start', () => sdkChannel.send({ type: 'message_start' }));
  processor.on('message_text', (text) => sdkChannel.send({ type: 'message_text', text }));
  processor.on('thinking_text', (text) => sdkChannel.send({ type: 'message_thinking', text }));
  processor.on('message_stop', () => sdkChannel.send({ type: 'message_end' }));
  processor.on('compaction_start', () => sdkChannel.send({ type: 'message_compaction_start' }));
  processor.on('compaction_complete', (summary) => sdkChannel.send({ type: 'message_compaction', summary }));
  processor.on('server_tool_use', (id, name, input) => sdkChannel.send({ type: 'server_tool_use', id, name, input }));
  processor.on('server_tool_result', (id, name, result) => sdkChannel.send({ type: 'server_tool_result', id, name, result }));
  processor.on('tool_use_start', (id, name) => sdkChannel.send({ type: 'tool_use_start', id, name }));
  processor.on('server_tool_use_start', (id, name) => sdkChannel.send({ type: 'server_tool_use_start', id, name }));
  processor.on('tool_use_input_delta', (id, partialJson) => sdkChannel.send({ type: 'tool_use_input_delta', id, partialJson }));
  processor.on('tool_use_input_stop', (id) => sdkChannel.send({ type: 'tool_use_input_stop', id }));

  // Tools (constructed once, schemas cached by the registry)
  const { tools, store, refTransform } = createAppTools(tsServer, configLoader.config.tools);
  const registry = new ToolRegistry(tools, logger);

  const transformToolResult = (toolName: string, output: unknown): unknown => {
    const result = refTransform(toolName, output);
    if (toolName !== 'Ref') {
      const bytes = (typeof result === 'string' ? result : JSON.stringify(result)).length;
      logger.debug('tool_result_size', { name: toolName, bytes });
    }
    return result;
  };

  // Runners
  const turnRunner = new TurnRunner(client, processor, logger);

  const mapConfig = (): DurableConfig => {
    const atuEnabled = configLoader.config.advancedTools.enabled;

    const serverTools: BetaToolUnion[] = buildServerTools(configLoader.config.serverTools, configLoader.config.advancedTools.codeExecutionTool, logger);
    if (atuEnabled && configLoader.config.advancedTools.searchTool != null) {
      if (configLoader.config.advancedTools.searchTool === 'regex') {
        serverTools.push({ name: 'tool_search_tool_regex', type: 'tool_search_tool_regex_20251119' } satisfies BetaToolSearchToolRegex20251119);
      } else {
        serverTools.push({ name: 'tool_search_tool_bm25', type: 'tool_search_tool_bm25_20251119' } satisfies BetaToolSearchToolBm25_20251119);
      }
    }

    return {
      model: getEffectiveModel(),
      maxTokens: configLoader.config.maxTokens,
      thinking: getEffectiveThinkingEnabled(),
      thinkingEffort: getEffectiveEffort(),
      systemPrompts,
      tools,
      serverTools,
      transformTool: buildAtuTransform(tools, configLoader.config.advancedTools),
      betas: {
        [AnthropicBeta.ClaudeCodeAuth]: true,
        [AnthropicBeta.ContextManagement]: false,
        [AnthropicBeta.PromptCachingScope]: false,
        [AnthropicBeta.AdvancedToolUse]: atuEnabled,
      },
      compact: {
        ...configLoader.config.compact,
        customInstructions: configLoader.config.compact.customInstructions ?? undefined,
      },
      requireToolApproval: true,
      cacheTtl: CacheTtl.OneHour,
    };
  };

  const durableConfig: DurableConfig = mapConfig();

  const queryRunner = new QueryRunner(turnRunner, conversation, registry, approval, sdkChannel, durableConfig, logger);

  // The handler listens on the consumer port for all events (stream events
  // forwarded above, plus SDK-level events sent by the QueryRunner) and
  // posts approval responses back on the same port.
  const actionFromConfig = (s: string): PermissionAction => {
    if (s === 'approve') return PermissionAction.Approve;
    if (s === 'ask') return PermissionAction.Ask;
    return PermissionAction.Deny;
  };
  const getPermissionMatrix = (): PermissionConfig => {
    const p = configLoader.config.permissions;
    return {
      default: {
        read: actionFromConfig(p.default.read),
        write: actionFromConfig(p.default.write),
        delete: actionFromConfig(p.default.delete),
      },
      outside: {
        read: actionFromConfig(p.outside.read),
        write: actionFromConfig(p.outside.write),
        delete: actionFromConfig(p.outside.delete),
      },
    };
  };

  const notifier = new ApprovalNotifier(configLoader.config.hooks.approvalNotify, new NodeProcessLauncher());
  const handler = new AgentMessageHandler(logger, {
    config: durableConfig,
    channel: consumerChannel,
    cwd,
    store,
    statusState,
    notifier,
    conversationState,
    toolApprovalState,
    getMatrix: getPermissionMatrix,
    fs: nodeFs,
  });
  sdkChannel.subscribe(async (msg: SdkMessage) => {
    handler.handle(msg);
  });

  if (configLoader.config.historyReplay.enabled) {
    const history = conversation.messages;
    if (history.length > 0) {
      conversationState.addBlocks(replayHistory(history, configLoader.config.historyReplay));
    }
  }

  conversationState.addBlocks([{ type: 'meta', content: startupBannerText() }]);
  if (configOverride !== undefined) {
    conversationState.addBlocks([{ type: 'meta', content: formatEffectiveConfig({ ...configLoader.config, model: getEffectiveModel() }) }]);
  }
  statusState.setModel(getEffectiveModel(), overrides.model != null);
  statusState.setShowConversationId(configLoader.config.statusBar.showConversationId);
  host.renderNow();

  // --- Main loop ---

  const gitMonitor = new GitStateMonitor();
  const claudeMdLoader = new ClaudeMdLoader(nodeFs);

  const runTurn = async (userInput: UserInput) => {
    const claudeMdContent = configLoader.config.claudeMd.enabled ? await claudeMdLoader.getContent(configLoader.config.claudeMd.sources) : null;

    // Update durable config with current values before each query
    Object.assign(durableConfig, mapConfig());
    durableConfig.cachedReminders = claudeMdContent != null ? [claudeMdContent] : undefined;

    const abortController = new AbortController();
    currentAbortController = abortController;

    statusState.setModel(getEffectiveModel(), overrides.model != null);
    turnInProgress = true;
    await session.saveSession();
    const gitDelta = await gitMonitor.getDelta();
    const agentInput = buildRunAgentInput(userInput);
    await runAgent(queryRunner, agentInput, { conversationState, toolApprovalState, commandModeState, editorState, primaryViewState }, () => flushSealedToScroll(conversationState, terminalState, renderer), transformToolResult, abortController, gitDelta);
    await gitMonitor.takeSnapshot();
    turnInProgress = false;

    currentAbortController = null;
    statusState.setModel(getEffectiveModel(), overrides.model != null);
    await session.saveConversation();
  };

  const hasInitialTurn = initialFilePaths.length > 0 || initialPrompt != null;
  if (hasInitialTurn) {
    await runTurn(await buildInitialInput(decodedPrompt ?? '', initialFilePaths));
  }

  while (true) {
    await runTurn(await editorHandler.waitForInput());
  }
};
await main();
