import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { BetaToolSearchToolBm25_20251119, BetaToolSearchToolRegex20251119 } from '@anthropic-ai/sdk/resources/beta.mjs';
import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { NodeConfigFileReader } from '@shellicar/claude-core/Config/NodeConfigFileReader';
import { NodeConfigWatcher } from '@shellicar/claude-core/Config/NodeConfigWatcher';
import { AnthropicAuth, AnthropicBeta, AnthropicClient, ApprovalCoordinator, type BetaToolUnion, CacheTtl, ControlChannel, Conversation, type ConsumerMessage, type DurableConfig, QueryRunner, type SdkMessage, StreamProcessor, ToolRegistry, TurnRunner } from '@shellicar/claude-sdk';
import { nodeFs } from '@shellicar/claude-sdk-tools/fs';
import { TsServerService } from '@shellicar/claude-sdk-tools/TsService';
import { AppLayout, type UserInput } from '../AppLayout.js';
import { AuditWriter } from '../AuditWriter.js';
import { buildAtuTransform } from '../buildAtuTransform.js';
import { buildServerTools } from '../buildServerTools.js';
import { ClaudeMdLoader } from '../ClaudeMdLoader.js';
import { CONFIG_PATH, LOCAL_CONFIG_PATH } from '../cli-config/consts.js';
import { initConfig } from '../cli-config/initConfig.js';
import { sdkConfigSchema } from '../cli-config/schema.js';
import { AgentMessageHandler } from '../controller/AgentMessageHandler.js';
import { createAppTools } from '../createAppTools.js';
import { GitStateMonitor } from '../GitStateMonitor.js';
import { printUsage, printVersion, printVersionInfo, startupBannerText } from '../help.js';
import { logger } from '../logger.js';
import { ApprovalNotifier } from '../model/ApprovalNotifier.js';
import { buildSubmitText } from '../model/buildSubmitText.js';
import { ConversationSession } from '../model/ConversationSession.js';
import { NodeProcessLauncher } from '../model/NodeProcessLauncher.js';
import { StatusState } from '../model/StatusState.js';
import { ReadLine } from '../ReadLine.js';
import { replayHistory } from '../replayHistory.js';
import { buildRunAgentInput, runAgent } from '../runAgent.js';
import { systemPrompts } from '../systemPrompts.js';

process.title = 'claude-sdk-cli';

const { values } = parseArgs({
  options: {
    version: { type: 'boolean', short: 'v', default: false },
    'version-info': { type: 'boolean', default: false },
    'init-config': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
    file: { type: 'string' },
  },
  strict: false,
});

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

if (values.help || process.argv.includes('-?')) {
  // biome-ignore lint/suspicious/noConsole: CLI --help output before app starts
  printUsage(console.log);
  process.exit(0);
}

if (!process.stdin.isTTY) {
  process.stderr.write('stdin is not a terminal. Run interactively.\n');
  process.exit(1);
}

const initialFilePath = typeof values.file === 'string' ? resolve(values.file.replace(/^~(?=\/|$)/, process.env.HOME ?? '')) : null;

async function buildFileInput(filePath: string): Promise<UserInput> {
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
  return {
    text: buildSubmitText('', [{ kind: 'file', path: filePath, fileType, sizeBytes }]),
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

  using rl = new ReadLine();
  const statusState = new StatusState(nodeFs);
  const conversation = new Conversation();
  const session = new ConversationSession(nodeFs, conversation);
  if (initialFilePath != null) {
    await session.startFresh();
  } else {
    await session.load();
  }
  const layout = new AppLayout(statusState, session);

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
    logger,
  });
  configLoader.load();
  configLoader.onChange((config) => {
    logger.info('config reloaded', { model: config.model });
    if (!turnInProgress) {
      statusState.setModel(config.model);
      layout.render();
    }
  });
  configLoader.start();

  const cwd = process.cwd();
  const tsServer = new TsServerService({ cwd });
  await tsServer.start();

  const cleanup = () => {
    tsServer.stop();
    configLoader.dispose();
    layout.exit();
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

  rl.setLayout(layout);
  layout.enter();

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
    if (msg.type === 'cancel' && currentAbortController) {
      currentAbortController.abort();
    }
    approval.handle(msg);
  });

  // Forward stream events to sdkChannel. AgentMessageHandler subscribes
  // to sdkChannel to receive all events.
  processor.on('message_start', () => sdkChannel.send({ type: 'message_start' }));
  processor.on('message_text', (text) => sdkChannel.send({ type: 'message_text', text }));
  processor.on('thinking_text', (text) => sdkChannel.send({ type: 'message_thinking', text }));
  processor.on('message_stop', () => sdkChannel.send({ type: 'message_end' }));
  processor.on('compaction_start', () => sdkChannel.send({ type: 'message_compaction_start' }));
  processor.on('compaction_complete', (summary) => sdkChannel.send({ type: 'message_compaction', summary }));
  processor.on('server_tool_use', (name, input) => sdkChannel.send({ type: 'server_tool_use', name, input }));
  processor.on('server_tool_result', (name, result) => sdkChannel.send({ type: 'server_tool_result', name, result }));

  // Tools (constructed once, schemas cached by the registry)
  const { tools, store, refTransform } = createAppTools(tsServer);
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
      model: configLoader.config.model,
      maxTokens: configLoader.config.maxTokens,
      thinking: true,
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
  const notifier = new ApprovalNotifier(configLoader.config.hooks.approvalNotify, new NodeProcessLauncher());
  const handler = new AgentMessageHandler(layout, logger, {
    config: durableConfig,
    channel: consumerChannel,
    cwd,
    store,
    statusState,
    notifier,
  });
  sdkChannel.subscribe(async (msg: SdkMessage) => {
    handler.handle(msg);
  });

  if (configLoader.config.historyReplay.enabled) {
    const history = conversation.messages;
    if (history.length > 0) {
      layout.addHistoryBlocks(replayHistory(history, configLoader.config.historyReplay));
    }
  }

  layout.showStartupBanner(startupBannerText());
  statusState.setModel(configLoader.config.model);
  layout.render();

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

    statusState.setModel(configLoader.config.model);
    layout.render();
    turnInProgress = true;
    await session.saveSession();
    const gitDelta = await gitMonitor.getDelta();
    const agentInput = buildRunAgentInput(userInput);
    await runAgent(queryRunner, agentInput, layout, consumerChannel, transformToolResult, abortController, gitDelta);
    await gitMonitor.takeSnapshot();
    turnInProgress = false;

    currentAbortController = null;
    statusState.setModel(configLoader.config.model);
    layout.render();
    await session.saveConversation();
  };

  if (initialFilePath != null) {
    await runTurn(await buildFileInput(initialFilePath));
  }

  while (true) {
    await runTurn(await layout.waitForInput());
  }
};
await main();
