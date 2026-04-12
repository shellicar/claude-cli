import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import type { Anthropic } from '@anthropic-ai/sdk';
import { AnthropicAuth, AnthropicBeta, AnthropicClient, type AnyToolDefinition, ApprovalCoordinator, CacheTtl, ControlChannel, Conversation, type DurableConfig, QueryRunner, type SdkMessage, StreamProcessor, ToolRegistry, TurnRunner } from '@shellicar/claude-sdk';
import { CreateFile } from '@shellicar/claude-sdk-tools/CreateFile';
import { DeleteDirectory } from '@shellicar/claude-sdk-tools/DeleteDirectory';
import { DeleteFile } from '@shellicar/claude-sdk-tools/DeleteFile';
import { EditFile } from '@shellicar/claude-sdk-tools/EditFile';
import { Exec } from '@shellicar/claude-sdk-tools/Exec';
import { Find } from '@shellicar/claude-sdk-tools/Find';
import { nodeFs } from '@shellicar/claude-sdk-tools/fs';
import { Grep } from '@shellicar/claude-sdk-tools/Grep';
import { Head } from '@shellicar/claude-sdk-tools/Head';
import { createPipe } from '@shellicar/claude-sdk-tools/Pipe';
import { PreviewEdit } from '@shellicar/claude-sdk-tools/PreviewEdit';
import { Range } from '@shellicar/claude-sdk-tools/Range';
import { ReadFile } from '@shellicar/claude-sdk-tools/ReadFile';
import { createRef } from '@shellicar/claude-sdk-tools/Ref';
import { RefStore } from '@shellicar/claude-sdk-tools/RefStore';
import { SearchFiles } from '@shellicar/claude-sdk-tools/SearchFiles';
import { Tail } from '@shellicar/claude-sdk-tools/Tail';
import { AppLayout } from '../AppLayout.js';
import { ClaudeMdLoader } from '../ClaudeMdLoader.js';
import { initConfig } from '../cli-config/initConfig.js';
import { SdkConfigWatcher } from '../cli-config/SdkConfigWatcher.js';
import { AgentMessageHandler } from '../controller/AgentMessageHandler.js';
import { GitStateMonitor } from '../GitStateMonitor.js';
import { printUsage, printVersion, printVersionInfo, startupBannerText } from '../help.js';
import { logger } from '../logger.js';
import { StatusState } from '../model/StatusState.js';
import { ReadLine } from '../ReadLine.js';
import { replayHistory } from '../replayHistory.js';
import { runAgent } from '../runAgent.js';
import { systemPrompts } from '../systemPrompts.js';

const { values } = parseArgs({
  options: {
    version: { type: 'boolean', short: 'v', default: false },
    'version-info': { type: 'boolean', default: false },
    'init-config': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
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

const HISTORY_FILE = '.sdk-history.jsonl';

function loadHistory(file: string): Anthropic.Beta.Messages.BetaMessageParam[] {
  try {
    const raw = readFileSync(file, 'utf-8');
    return raw
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Anthropic.Beta.Messages.BetaMessageParam);
  } catch {
    return [];
  }
}

function saveHistory(conversation: Conversation, file: string): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, conversation.messages.map((msg) => JSON.stringify(msg)).join('\n'));
  renameSync(tmp, file);
}

const main = async () => {
  const auth = new AnthropicAuth({ redirect: 'local' });
  await auth.getCredentials();
  const authToken = async () => {
    const credentials = await auth.getCredentials();
    return credentials.claudeAiOauth.accessToken;
  };

  using rl = new ReadLine();
  const statusState = new StatusState();
  const layout = new AppLayout(statusState);

  let turnInProgress = false;
  const watcher = new SdkConfigWatcher((config) => {
    logger.info('config reloaded', { model: config.model });
    if (!turnInProgress) {
      statusState.setModel(config.model);
      layout.render();
    }
  });

  const cleanup = () => {
    watcher.dispose();
    layout.exit();
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  rl.setLayout(layout);
  layout.enter();

  // --- SDK blocks (constructed once, reused for every query) ---

  const client = new AnthropicClient({ authToken, logger });
  const conversation = new Conversation();
  const processor = new StreamProcessor(logger);
  const approval = new ApprovalCoordinator();

  // Per-query abort controller. Mutated before each query so the long-lived
  // channel listener can reach the current controller.
  let currentAbortController: AbortController | null = null;

  const channel = new ControlChannel();
  channel.on('message', (msg) => {
    if (msg.type === 'cancel' && currentAbortController) {
      currentAbortController.abort();
    }
    approval.handle(msg);
  });

  // Forward stream events to the channel once. The AgentMessageHandler
  // receives all events through the channel's consumer port, same as before.
  processor.on('message_start', () => channel.send({ type: 'message_start' }));
  processor.on('message_text', (text) => channel.send({ type: 'message_text', text }));
  processor.on('thinking_text', (text) => channel.send({ type: 'message_thinking', text }));
  processor.on('message_stop', () => channel.send({ type: 'message_end' }));
  processor.on('compaction_start', () => channel.send({ type: 'message_compaction_start' }));
  processor.on('compaction_complete', (summary) => channel.send({ type: 'message_compaction', summary }));

  // Tools (constructed once, schemas cached by the registry)
  const store = new RefStore();
  const pipeSource = [Find, ReadFile, Grep, Head, Tail, Range, SearchFiles];
  const { tool: Ref, transformToolResult: refTransform } = createRef(store, 20_000);
  const otherTools = [PreviewEdit, EditFile, CreateFile, DeleteFile, DeleteDirectory, Exec, Ref];
  const pipe = createPipe(pipeSource);
  const tools: AnyToolDefinition[] = [pipe, ...pipeSource, ...otherTools];
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
  const cwd = process.cwd();

  const durableConfig: DurableConfig = {
    model: watcher.config.model,
    maxTokens: 32000,
    thinking: true,
    systemPrompts,
    tools,
    betas: {
      [AnthropicBeta.Compact]: true,
      [AnthropicBeta.ClaudeCodeAuth]: true,
      [AnthropicBeta.ContextManagement]: false,
      [AnthropicBeta.PromptCachingScope]: false,
      [AnthropicBeta.AdvancedToolUse]: true,
    },
    requireToolApproval: true,
    pauseAfterCompact: true,
    compactInputTokens: 160_000,
    cacheTtl: CacheTtl.OneHour,
  };

  const queryRunner = new QueryRunner(turnRunner, conversation, registry, approval, channel, durableConfig, logger);

  // The handler listens on the consumer port for all events (stream events
  // forwarded above, plus SDK-level events sent by the QueryRunner) and
  // posts approval responses back on the same port.
  const handler = new AgentMessageHandler(layout, logger, {
    config: durableConfig,
    port: channel.consumerPort,
    cwd,
    store,
    statusState,
  });
  channel.consumerPort.on('message', (msg: SdkMessage) => {
    handler.handle(msg);
  });

  // --- History ---

  const savedHistory = loadHistory(HISTORY_FILE);
  if (savedHistory.length > 0) {
    conversation.setHistory(savedHistory);
  }

  if (watcher.config.historyReplay.enabled) {
    const history = conversation.messages;
    if (history.length > 0) {
      layout.addHistoryBlocks(replayHistory(history, watcher.config.historyReplay));
    }
  }

  layout.showStartupBanner(startupBannerText());
  statusState.setModel(watcher.config.model);
  layout.render();

  // --- Main loop ---

  const gitMonitor = new GitStateMonitor();
  const claudeMdLoader = new ClaudeMdLoader(nodeFs);

  while (true) {
    const prompt = await layout.waitForInput();
    const claudeMdContent = watcher.config.claudeMd.enabled ? await claudeMdLoader.getContent() : null;

    // Update durable config with current values before each query
    durableConfig.model = watcher.config.model;
    durableConfig.cachedReminders = claudeMdContent != null ? [claudeMdContent] : undefined;

    const abortController = new AbortController();
    currentAbortController = abortController;

    statusState.setModel(watcher.config.model);
    layout.render();
    turnInProgress = true;
    const gitDelta = await gitMonitor.getDelta();
    await runAgent(queryRunner, prompt, layout, channel.consumerPort, transformToolResult, abortController, gitDelta);
    await gitMonitor.takeSnapshot();
    turnInProgress = false;

    currentAbortController = null;
    statusState.setModel(watcher.config.model);
    layout.render();
    saveHistory(conversation, HISTORY_FILE);
  }
};
await main();
