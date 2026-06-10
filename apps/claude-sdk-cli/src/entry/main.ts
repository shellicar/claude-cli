import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { NodeConfigFileReader } from '@shellicar/claude-core/Config/NodeConfigFileReader';
import { NodeDirectoryWatcher } from '@shellicar/claude-core/Config/NodeDirectoryWatcher';
import { AnthropicAuth, AnthropicClient, ApprovalCoordinator, Conversation, QueryRunner, type SdkMessage, StreamProcessor } from '@shellicar/claude-sdk';
import { nodeFs } from '@shellicar/claude-sdk-tools/fs';
import { TsServerService } from '@shellicar/claude-sdk-tools/TsService';
import { z } from 'zod';
import { AuditWriter } from '../AuditWriter.js';
import { ViewHost } from '../app/ViewHost.js';
import { ClaudeMdLoader } from '../ClaudeMdLoader.js';
import { CONFIG_PATH, LOCAL_CONFIG_PATH } from '../cli-config/consts.js';
import { formatEffectiveConfig } from '../cli-config/formatEffectiveConfig.js';
import { formatPermissionsDisplay } from '../cli-config/formatPermissionChange.js';
import { initConfig } from '../cli-config/initConfig.js';
import { parseConfigOverride } from '../cli-config/parseConfigOverride.js';
import { sdkConfigSchema } from '../cli-config/schema.js';
import { AgentMessageHandler } from '../controller/AgentMessageHandler.js';
import { EditorHandler } from '../controller/EditorHandler.js';
import { decodePromptEscapes } from '../decodePromptEscapes.js';
import { GitStateMonitor } from '../GitStateMonitor.js';
import { printUsage, printVersion, printVersionInfo, startupBannerText } from '../help.js';
import { logger } from '../logger.js';
import { buildSubmitText } from '../model/buildSubmitText.js';
import { CommandModeState } from '../model/CommandModeState.js';
import { ConversationSession } from '../model/ConversationSession.js';
import { ConversationState } from '../model/ConversationState.js';
import { EditorState } from '../model/EditorState.js';
import { PrimaryViewState } from '../model/PrimaryViewState.js';
import { StatusState } from '../model/StatusState.js';
import { TerminalState } from '../model/TerminalState.js';
import { ToolApprovalState } from '../model/ToolApprovalState.js';
import { ReadLine } from '../ReadLine.js';
import { replayHistory } from '../replayHistory.js';
import { buildRunAgentInput, runAgent, type UserInput } from '../runAgent.js';
import { AppToolsService } from '../setup/AppToolsService.js';
import { ConsumerChannel } from '../setup/ConsumerChannel.js';
import { buildContainer } from '../setup/container.js';
import { DurableConfigFactory } from '../setup/DurableConfigFactory.js';
import { ModelOverrides } from '../setup/ModelOverrides.js';
import { SdkChannel } from '../setup/SdkChannel.js';
import { Flasher } from '../view/Flasher.js';
import { flushSealedToScroll } from '../view/flushSealedToScroll.js';
import { TerminalRenderer } from '../view/TerminalRenderer.js';

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
      system: { type: 'string' },
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
const systemFlag = typeof values.system === 'string' ? values.system : null;
const decodedSystem = systemFlag != null ? decodePromptEscapes(systemFlag) : null;
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
  // Composition: build ConfigLoader first (load() must precede buildProvider)
  const configLoader = new ConfigLoader({
    schema: sdkConfigSchema,
    paths: [CONFIG_PATH, LOCAL_CONFIG_PATH],
    reader: new NodeConfigFileReader(),
    watcher: new NodeDirectoryWatcher(),
    fs: nodeFs,
    // Hook commands may be written as `~`, `$HOME`, or config-relative paths;
    // the loader resolves them per-source so a relative path always refers to
    // the directory of the file it was authored in.
    pathFields: [['hooks', 'approvalNotify', 'command']],
    overrides: configOverride === undefined ? undefined : { origin: ':parameters:', raw: configOverride },
    logger,
  });
  configLoader.load();

  const provider = buildContainer({ configLoader, modelOverride, systemFlagText: decodedSystem });

  // Activation: async startup
  await provider.resolve(AnthropicAuth).getCredentials();

  const session = provider.resolve(ConversationSession);
  if (resumeId != null) {
    await session.resume(resumeId);
  } else if (initialFilePaths.length > 0 || initialPrompt != null || noResume) {
    await session.startFresh();
  } else {
    await session.load();
  }
  if (sessionName != null) {
    provider.resolve(StatusState).setSessionName(sessionName);
  }

  const overrides = provider.resolve(ModelOverrides);
  const statusState = provider.resolve(StatusState);
  const conversationState = provider.resolve(ConversationState);
  let turnInProgress = false;
  configLoader.onChange((config) => {
    logger.info('config reloaded', { model: config.model });
    conversationState.spliceNotice(formatPermissionsDisplay(config.permissions));
    if (!turnInProgress) {
      statusState.setModel(overrides.model ?? config.model, overrides.model != null);
      statusState.setShowConversationId(config.statusBar.showConversationId);
    }
  });
  configLoader.start();
  await provider.resolve(TsServerService).start();

  const cleanup = () => {
    provider.resolve(TsServerService).stop();
    configLoader.dispose();
    provider.resolve(TerminalRenderer).exit();
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

  const client = provider.resolve(AnthropicClient);
  client.on('finalMessage', (msg) => provider.resolve(AuditWriter).write(session.id, msg));

  const sdkChannel = provider.resolve(SdkChannel);
  const consumerChannel = provider.resolve(ConsumerChannel);
  // Per-query abort controller. Mutated before each query so the long-lived
  // channel listener can reach the current controller.
  let currentAbortController: AbortController | null = null;
  consumerChannel.subscribe(async (msg) => {
    const outcome = provider.resolve(ApprovalCoordinator).handle(msg);
    // A tool-cancel must NOT abort the query controller: the delivery turn
    // reuses it to send the cancellation tool_result to the model. Only a
    // query-cancel (model streaming, or a second ESC during a tool) aborts it.
    if (outcome === 'query_cancel' && currentAbortController) {
      currentAbortController.abort();
    }
  });

  using renderer = provider.resolve(TerminalRenderer);
  using host = provider.resolve(ViewHost);
  using _flasher = provider.resolve(Flasher);
  using _ = provider.resolve(ReadLine);

  renderer.enter();
  host.renderNow();

  // Forward stream events to sdkChannel. AgentMessageHandler subscribes
  // to sdkChannel to receive all events.
  const processor = provider.resolve(StreamProcessor);
  processor.on('message_start', () => sdkChannel.send({ type: 'message_start' }));
  processor.on('message_text', (text) => sdkChannel.send({ type: 'message_text', text }));
  processor.on('thinking_text', (text) => sdkChannel.send({ type: 'message_thinking', text }));
  processor.on('message_stop', () => sdkChannel.send({ type: 'message_end' }));
  processor.on('compaction_complete', (summary) => sdkChannel.send({ type: 'message_compaction', summary }));
  processor.on('server_tool_use', (id, name, input) => sdkChannel.send({ type: 'server_tool_use', id, name, input }));
  processor.on('server_tool_result', (id, name, result) => sdkChannel.send({ type: 'server_tool_result', id, name, result }));
  processor.on('tool_use_start', (id, name) => sdkChannel.send({ type: 'tool_use_start', id, name }));
  processor.on('server_tool_use_start', (id, name) => sdkChannel.send({ type: 'server_tool_use_start', id, name }));
  processor.on('tool_use_input_delta', (id, partialJson) => sdkChannel.send({ type: 'tool_use_input_delta', id, partialJson }));
  processor.on('tool_use_input_stop', (id, input) => sdkChannel.send({ type: 'tool_use_input_stop', id, input }));
  processor.on('enter_block', (blockType) => sdkChannel.send({ type: 'block_enter', blockType }));
  processor.on('exit_block', (blockType) => sdkChannel.send({ type: 'block_exit', blockType }));
  processor.on('tool_batch_start', () => sdkChannel.send({ type: 'tool_batch_start' }));
  processor.on('tool_batch_end', () => sdkChannel.send({ type: 'tool_batch_end' }));

  // Tools (accessed via AppToolsService singleton in the container)
  const appTools = provider.resolve(AppToolsService);
  const transformToolResult = (toolName: string, output: unknown): unknown => {
    const result = appTools.refTransform(toolName, output);
    if (toolName !== 'Ref') {
      const bytes = (typeof result === 'string' ? result : JSON.stringify(result)).length;
      logger.debug('tool_result_size', { name: toolName, bytes });
    }
    return result;
  };

  const queryRunner = provider.resolve(QueryRunner);
  const handler = provider.resolve(AgentMessageHandler);
  const configFactory = provider.resolve(DurableConfigFactory);
  // System prompts are read from SYSTEM.md (async I/O), so resolution is
  // activation. Resolve once for this session here; runTurn re-resolves on a
  // session change. configFactory.update() then folds them into the config.
  await configFactory.resolveSystemPromptsFor(session.id);
  sdkChannel.subscribe(async (msg: SdkMessage) => {
    handler.handle(msg);
  });

  const conversation = provider.resolve(Conversation);
  if (configLoader.config.historyReplay.enabled) {
    const history = conversation.messages;
    if (history.length > 0) {
      conversationState.addBlocks(replayHistory(history, configLoader.config.historyReplay));
    }
  }

  conversationState.addBlocks([{ type: 'meta', content: startupBannerText() }]);
  if (configOverride !== undefined) {
    conversationState.addBlocks([{ type: 'meta', content: formatEffectiveConfig({ ...configLoader.config, model: configFactory.getEffectiveModel() }) }]);
  }
  statusState.setModel(configFactory.getEffectiveModel(), overrides.model != null);
  statusState.setShowConversationId(configLoader.config.statusBar.showConversationId);
  host.renderNow();

  // --- Main loop ---

  const gitMonitor = provider.resolve(GitStateMonitor);
  const claudeMdLoader = provider.resolve(ClaudeMdLoader);
  const editorHandler = provider.resolve(EditorHandler);

  const runTurn = async (userInput: UserInput) => {
    const claudeMdContent = configLoader.config.claudeMd.enabled ? await claudeMdLoader.getContent(configLoader.config.claudeMd.sources) : null;
    if (configFactory.needsSystemPromptResolve(session.id)) {
      await configFactory.resolveSystemPromptsFor(session.id);
    }
    configFactory.update(claudeMdContent);

    const abortController = new AbortController();
    currentAbortController = abortController;
    statusState.setModel(configFactory.getEffectiveModel(), overrides.model != null);
    turnInProgress = true;
    await session.saveSession();
    const gitDelta = await gitMonitor.getDelta();
    const agentInput = buildRunAgentInput(userInput);
    await runAgent(
      queryRunner,
      agentInput,
      {
        conversationState,
        toolApprovalState: provider.resolve(ToolApprovalState),
        commandModeState: provider.resolve(CommandModeState),
        editorState: provider.resolve(EditorState),
        primaryViewState: provider.resolve(PrimaryViewState),
      },
      () => flushSealedToScroll(conversationState, provider.resolve(TerminalState), renderer),
      transformToolResult,
      abortController,
      gitDelta,
    );
    await gitMonitor.takeSnapshot();
    turnInProgress = false;

    currentAbortController = null;
    statusState.setModel(configFactory.getEffectiveModel(), overrides.model != null);
    await session.saveConversation();
  };

  const hasInitialTurn = initialFilePaths.length > 0 || initialPrompt != null;
  if (hasInitialTurn) {
    await runTurn(await buildInitialInput(decodedPrompt ?? '', initialFilePaths));
  }

  while (true) {
    conversationState.markPromptStart();
    await runTurn(await editorHandler.waitForInput());
  }
};
await main();
