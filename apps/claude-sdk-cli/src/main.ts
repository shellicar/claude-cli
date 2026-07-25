import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Clock } from '@js-joda/core';
import { BOLD_WHITE, RESET } from '@shellicar/claude-core/ansi';
import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import type { IConfigOptions } from '@shellicar/claude-core/Config/IConfigOptions';
import { IConfigWatcher } from '@shellicar/claude-core/Config/interfaces';
import { ConfigWatchHandle } from '@shellicar/claude-core/Config/types';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { IHistorySweeper } from '@shellicar/claude-core/history/interfaces';
import { AnthropicAuth, ApprovalCoordinator, CacheTtl, IConversation, IDurableConfigProvider, QueryRunner } from '@shellicar/claude-sdk';
import { DEFAULT_TSSERVER_TIMEOUT_MS, type ITsServerOptions, resolveTsServerPath } from '@shellicar/claude-sdk-tools/TsService';
import { z } from 'zod';
import { AuditStats } from './AuditStats.js';
import { IAgentPresence } from './agent/AgentPresence.js';
import { IAgentServe } from './agent/AgentServe.js';
import { IAgentServicer } from './agent/AgentServicer.js';
import { ViewHost } from './app/ViewHost.js';
import { IBus } from './bus/IBus.js';
import { ClaudeMdLoader } from './ClaudeMdLoader.js';
import { CONFIG_PATH, localConfigPath } from './cli-config/consts.js';
import { formatEffectiveConfig } from './cli-config/formatEffectiveConfig.js';
import { initConfig } from './cli-config/initConfig.js';
import { parseConfigOverride } from './cli-config/parseConfigOverride.js';
import { sdkConfigSchema } from './cli-config/schema.js';
import { EditorHandler } from './controller/EditorHandler.js';
import { IConvChangePublisher } from './conv/ConvChangePublisher.js';
import { IConvServe } from './conv/ConvServe.js';
import { IConvServicer } from './conv/ConvServicer.js';
import { IConvTelemetryProjector } from './conv/ConvTelemetryProjector.js';
import { telemetryLeaf } from './conv/telemetryLeaf.js';
import { IWireSayInbox } from './conv/WireSayInbox.js';
import { stamp } from './conv/wire.js';
import { decodePromptEscapes } from './decodePromptEscapes.js';
import { runVerify } from './entry/verify.js';
import { GitStateMonitor } from './GitStateMonitor.js';
import { printUsage, printVersion, printVersionInfo, startupBannerText } from './help.js';
import { logger } from './logger.js';
import { buildSubmitText } from './model/buildSubmitText.js';
import { IConversationSession } from './model/ConversationSession.js';
import { IConversationState } from './model/ConversationState.js';
import { IEditorState } from './model/EditorState.js';
import { type IdentityRead, ISystemIdentity } from './model/ISystemIdentity.js';
import { PermissionsNoticeGate } from './model/PermissionsNoticeGate.js';
import { IPrimaryViewState } from './model/PrimaryViewState.js';
import { StatusState } from './model/StatusState.js';
import { ITerminalState } from './model/TerminalState.js';
import { IToolApprovalState } from './model/ToolApprovalState.js';
import { HistorySweepScheduler } from './persistence/HistorySweepScheduler.js';
import { ReadLine } from './ReadLine.js';
import { replayHistory } from './replayHistory.js';
import { buildRunAgentInput, runAgent, type UserInput } from './runAgent.js';
import { AppToolsService } from './setup/AppToolsService.js';
import { IRulesConfigNotifier, RulesConfigWatchHandle } from './setup/ConfigRulesConfigProvider.js';
import { ConsumerChannel } from './setup/ConsumerChannel.js';
import { CwdTracker } from './setup/CwdTracker.js';
import { buildContainer, type ContainerOptions } from './setup/container.js';
import type { IRuntimeOptions } from './setup/IRuntimeOptions.js';
import { ModelOverrides } from './setup/ModelOverrides.js';
import { SdkChannel } from './setup/SdkChannel.js';
import { ISdkEventBridge } from './setup/SdkEventBridge.js';
import { IShutdownCoordinator } from './setup/ShutdownCoordinator.js';
import { SkillCatalogueTracker } from './setup/SkillCatalogueTracker.js';
import { IWorkingDirectoryMoveHandler } from './setup/WorkingDirectoryMoveHandler.js';
import { Flasher } from './view/Flasher.js';
import { flushSealedToScroll } from './view/flushSealedToScroll.js';
import { TerminalRenderer } from './view/TerminalRenderer.js';

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

/**
 * Maps a live identity read to the status-line name: the frontmatter `name`
 * when present, `unknown` when the file is present but names nothing, and no
 * segment (null) when the file is missing or no identity is owned.
 */
const identityNameFor = (identity: IdentityRead): string | null => {
  if (identity.state !== 'present') {
    return null;
  }
  return identity.name ?? 'unknown';
};

type RunAppArgs = {
  initialFilePaths: string[];
  initialPrompt: string | null;
  decodedPrompt: string | null;
  noResume: boolean;
  sessionName: string | null;
  resumeId: string | null;
  identityPath: string | null;
  configOverride: Record<string, unknown> | undefined;
};

type RunAppInput = ContainerOptions & { args: RunAppArgs };

/**
 * The procedural startup. Holds everything that used to run at module scope:
 * argv parsing, the early-exit branches, and the parameter extraction. Builds
 * the registered options objects (decision 8) from argv and passes them into
 * the container via `runApp` / `runVerify`; nothing is `new`'d here (decision 9).
 * The only import-time effect of `entry/main.ts` is calling this (decision 13).
 */
export const main = async (): Promise<void> => {
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
        verify: { type: 'boolean', default: false },
        'init-config': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        file: { type: 'string', multiple: true },
        name: { type: 'string' },
        model: { type: 'string' },
        prompt: { type: 'string' },
        system: { type: 'string' },
        claudeMd: { type: 'string' },
        'system-identity': { type: 'string' },
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
  // --verify is non-interactive (it runs in CI and under Claude), so it must
  // not be gated on a TTY; it is handled below once the options objects exist.
  if (!values.verify && !process.stdin.isTTY) {
    process.stderr.write('stdin is not a terminal. Run interactively.\n');
    process.exit(1);
  }

  const initialFilePaths = Array.isArray(values.file) ? (values.file as string[]).map((p) => resolve(p.replace(/^~(?=\/|$)/, process.env.HOME ?? ''))) : [];
  const initialPrompt = typeof values.prompt === 'string' ? values.prompt : null;
  const decodedPrompt = initialPrompt != null ? decodePromptEscapes(initialPrompt) : null;
  const systemFlag = typeof values.system === 'string' ? values.system : null;
  const decodedSystem = systemFlag != null ? decodePromptEscapes(systemFlag) : null;
  const claudeMdFlag = typeof values.claudeMd === 'string' ? values.claudeMd : null;
  const decodedClaudeMd = claudeMdFlag != null ? decodePromptEscapes(claudeMdFlag) : null;
  const identityFlag = typeof values['system-identity'] === 'string' ? values['system-identity'] : null;
  const identityPath = identityFlag != null ? resolve(identityFlag.replace(/^~(?=\/|$)/, process.env.HOME ?? '')) : null;
  const noResume = values['no-resume'] === true;
  const sessionName = typeof values.name === 'string' ? values.name : null;
  const modelOverride = typeof values.model === 'string' ? values.model : null;
  const resumeId = typeof values.resume === 'string' ? values.resume : null;
  if (resumeId != null) {
    const result = z.string().uuid().safeParse(resumeId);
    if (!result.success) {
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

  // Runtime values from argv ride on registered options objects (decision 8).
  const tsserverPath = resolveTsServerPath();
  const configOptions = {
    schema: sdkConfigSchema,
    // Read live so a mid-session move re-points the local override at the new
    // directory's .claude/sdk-config.json — nothing is captured at startup.
    get paths() {
      return [CONFIG_PATH, localConfigPath()];
    },
    // Hook commands may be written as `~`, `$HOME`, or config-relative paths;
    // the loader resolves them per-source so a relative path always refers to
    // the directory of the file it was authored in.
    pathFields: [['hooks', 'approvalNotify', 'command']],
    overrides: configOverride === undefined ? undefined : { origin: ':parameters:', raw: configOverride },
  } satisfies IConfigOptions;
  const runtimeOptions = { modelOverride, systemFlagText: decodedSystem, claudeMdFlagText: decodedClaudeMd, tsAvailable: tsserverPath != null } satisfies IRuntimeOptions;
  const tsServerOptions = { tsserverPath, timeoutMs: DEFAULT_TSSERVER_TIMEOUT_MS } satisfies ITsServerOptions;
  const base = { configOptions, runtimeOptions, tsServerOptions };

  if (values.verify) {
    process.exit(await runVerify({ ...base, databaseOptions: { inMemory: true } }, (line) => process.stdout.write(`${line}\n`)));
  }

  await runApp({
    ...base,
    databaseOptions: { inMemory: false },
    args: { initialFilePaths, initialPrompt, decodedPrompt, noResume, sessionName, resumeId, identityPath, configOverride },
  });
};

const runApp = async ({ configOptions, runtimeOptions, tsServerOptions, databaseOptions, args }: RunAppInput): Promise<void> => {
  const { initialFilePaths, initialPrompt, decodedPrompt, noResume, sessionName, resumeId, identityPath, configOverride } = args;

  const provider = buildContainer({ configOptions, runtimeOptions, tsServerOptions, databaseOptions }).buildProvider();
  // The config holder is built (and read) eagerly at buildProvider, and the watch is started by the
  // ConfigWatchHandle factory at buildProvider. Eager here only to fail fast on a broken config before
  // anything else starts; ownership of both watches (dispose + re-point on cd) belongs to
  // WorkingDirectoryMoveHandler, resolved below, which injects the same singleton instances.
  provider.resolve(ConfigWatchHandle);
  const configLoader = provider.resolve(ConfigLoader);
  // Isolated from the watch above (see ConfigRulesConfigProvider): resolving it here forces its
  // RulesConfigGate dependency to build and validate eagerly, throwing on an invalid initial config
  // before anything else starts.
  provider.resolve(RulesConfigWatchHandle);

  // Activation: async startup
  await provider.resolve(AnthropicAuth).getCredentials();

  const session = provider.resolve(IConversationSession);
  if (resumeId != null) {
    await session.resume(resumeId);
  } else if (initialFilePaths.length > 0 || initialPrompt != null || noResume) {
    await session.startFresh();
  } else {
    await session.load();
  }

  // Passing --system-identity ASSERTS (set + persist, unconditional); its
  // absence DEFERS to what the conversation already owns. The strict existence
  // check is the one moment a missing file is fatal — everywhere else it
  // degrades to a warn.
  const systemIdentity = provider.resolve(ISystemIdentity);
  if (identityPath != null) {
    const exists = await provider.resolve(IFileSystem).exists(identityPath);
    if (!exists) {
      process.stderr.write(`identity file not found: ${identityPath}\n`);
      process.exit(1);
    }
    systemIdentity.assert(session.id, identityPath);
  } else {
    systemIdentity.load(session.id);
  }

  if (sessionName != null) {
    provider.resolve(StatusState).setSessionName(sessionName);
  }

  // Bus: one NATS connection, resolved and connected before the loop. When enabled and the broker is
  // unreachable start() throws, propagating to entry/main.ts which prints and exits 1. Disabled: start()
  // returns before any connection or NATS import. The conv/approval concerns publish and serve through it.
  const bus = provider.resolve(IBus);
  await bus.start();
  const clock = provider.resolve(Clock);
  const convChanges = provider.resolve(IConvChangePublisher);
  const convServicer = provider.resolve(IConvServicer);
  const wireSayInbox = provider.resolve(IWireSayInbox);
  const convTelemetry = provider.resolve(IConvTelemetryProjector);
  // The addressable face: a wire `say`/`cancel` on this conversation's requests subject. ConvServe owns
  // the binding so `/new` can re-point it to the new conversation (see CommandIntentExecutor).
  const convServe = provider.resolve(IConvServe);
  convServe.bind(session.id);

  // The agent concern: this process is one instance serving one world. ready/pulse start immediately;
  // the world's requests subject (service/drain/chdir) binds once, for the process's lifetime; attach
  // follows the conversation binding above and re-fires on every /new and every cwd move.
  const agentPresence = provider.resolve(IAgentPresence);
  const agentServicer = provider.resolve(IAgentServicer);
  provider.resolve(IAgentServe).bind();
  agentPresence.boot();
  agentPresence.attach(session.id, provider.resolve(IFileSystem).cwd());
  agentServicer.on('drain', () => void cleanup('drain'));

  const overrides = provider.resolve(ModelOverrides);
  const statusState = provider.resolve(StatusState);
  const conversationState = provider.resolve(IConversationState);
  const toolApprovalState = provider.resolve(IToolApprovalState);
  const editorState = provider.resolve(IEditorState);
  const primaryViewState = provider.resolve(IPrimaryViewState);
  const terminalState = provider.resolve(ITerminalState);
  const permissionsNoticeGate = provider.resolve(PermissionsNoticeGate);
  // tools.rules/tools.blockedCommands validate and watch independently of the whole-document
  // reload above (see ConfigRulesConfigProvider); it never fires through configLoader.onChange,
  // so it needs its own splice point. Kept short — no rule dump, just that something changed.
  provider.resolve(IRulesConfigNotifier).onNotice((notice) => {
    if (notice.kind === 'invalid') {
      conversationState.spliceNotice(`\u26a0\ufe0f tools.rules/tools.blockedCommands is invalid \u2014 keeping the previous rules (${notice.error})`);
    } else if (notice.kind === 'recovered') {
      conversationState.spliceNotice('\u2705 tools.rules/tools.blockedCommands valid again');
    } else {
      conversationState.spliceNotice('\ud83d\udee1\ufe0f tools.rules/tools.blockedCommands updated');
    }
  });

  let turnInProgress = false;
  configLoader.onChange((config) => {
    logger.info('config reloaded', { model: config.model });
    const permissionsNotice = permissionsNoticeGate.update(config.permissions);
    if (permissionsNotice != null) {
      conversationState.spliceNotice(permissionsNotice);
    }
    if (!turnInProgress) {
      statusState.setModel(configFactory.getEffectiveModel(), overrides.model != null);
      statusState.setShowConversationId(config.statusBar.showConversationId);
    }
  });
  // Holds the identity-file watch (when an identity is owned) so cleanup can
  // stop it on an abrupt exit, the same way the config watch is stopped below.
  let identityWatch: ConfigWatchHandle | null = null;
  const cleanup = async (reason: string) => {
    sweepScheduler?.stop();
    // Released, deliberately (agent-spec): detach before the connection drops, so a clean exit reads as
    // `detached`, never as silence (which folds to stranded). Best-effort, bounded with the drain below.
    agentPresence.detach(session.id);
    agentPresence.stop();
    // Best-effort clean-exit announce, bounded so a slow or absent broker cannot hold the process open.
    // run_ended is clean-exit only; an ungraceful death is covered by heartbeat silence, not this.
    await Promise.race([bus.stop(), new Promise<void>((done) => setTimeout(done, 500).unref())]);
    // SIGINT exits abruptly (process.exit bypasses `using` disposal), so stop
    // the config watch explicitly. Dispose the current handle — after a move it
    // is a re-pointed watch, not the one the factory first built.
    workingDirectoryMoveHandler.dispose();
    identityWatch?.[Symbol.dispose]();
    provider.resolve(TerminalRenderer).exit();
    process.stdout.write(`Resume with: ${BOLD_WHITE}--resume ${session.id}${RESET}\n`);
    process.exit(0);
  };
  // A keypress quit (QuitHandler, ctrl+c) requests this coordinator rather than exiting directly, so it
  // joins the same sequence SIGINT/SIGTERM/drain use — including the agent-concern detach — instead of
  // racing around it.
  provider.resolve(IShutdownCoordinator).onRequest((reason) => void cleanup(reason));
  let sigintReceived = false;
  process.on('SIGINT', () => {
    if (sigintReceived) {
      process.exit(1);
    }
    sigintReceived = true;
    void cleanup('sigint');
  });
  process.on('SIGTERM', () => void cleanup('sigterm'));
  process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
    logger.error('uncaughtException', err);
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandledRejection', reason);
  });

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
      const cancelled = telemetryLeaf(convTelemetry.cancelled());
      bus.publish(`conv.v2.${session.id}.telemetry.${cancelled.leaf}`, stamp(clock, cancelled.rest));
      const cancelledQueryId = session.conversationTip()?.queryId;
      if (cancelledQueryId != null) {
        convChanges.closeQuery(session.id, cancelledQueryId, 'cancelled');
      }
      currentAbortController.abort();
    } else if (outcome === 'tool_cancel') {
      sdkChannel.send({ type: 'tool_cancelling' });
    }
  });

  using renderer = provider.resolve(TerminalRenderer);
  using host = provider.resolve(ViewHost);
  using _flasher = provider.resolve(Flasher);
  using _ = provider.resolve(ReadLine);

  renderer.enter();
  host.renderNow();

  // Turn-time clock repaint: the active role's total ticks while idle. The
  // terminal already repaints fully on activity; this covers the idle case.
  const clockRepaint = setInterval(() => host.scheduleRender(), 1000);
  clockRepaint.unref();

  // Background dedup maintenance over history.db. The scheduler jitters each pass (5–10 min apart) so many CLIs on the
  // machine do not reach for the sweep lease together, and its timer is unref'd so it never holds the process open;
  // cleanup stops it on exit. A pass is best-effort over a rebuildable index — a failure is logged and swallowed.
  const sweepScheduler = new HistorySweepScheduler(provider.resolve(IHistorySweeper), logger, { minDelayMs: 5 * 60_000, maxDelayMs: 10 * 60_000 });
  sweepScheduler.start();

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
  const skillTracker = provider.resolve(SkillCatalogueTracker);
  const cwdTracker = provider.resolve(CwdTracker);
  const configFactory = provider.resolve(IDurableConfigProvider);
  // System prompts are read from SYSTEM.md (async file I/O over the constructed
  // factory). Resolve once for this session here; runTurn re-resolves on a
  // session change. The config getter reads the resolved prompts each turn.
  await configFactory.resolveSystemPromptsFor(session.id);
  // Scan the configured skill roots once and hold the catalogue reminder. Static for the session; it
  // rides cachedReminders (see DurableConfigFactory.update) into the first user message and post-compact.
  await configFactory.resolveSkillCatalogue();
  const sdkEventBridge = provider.resolve(ISdkEventBridge);
  sdkEventBridge.wire();

  const conversation = provider.resolve(IConversation);
  if (configLoader.config.historyReplay.enabled) {
    const history = conversation.messages;
    if (history.length > 0) {
      conversationState.addBlocks(replayHistory(history, configLoader.config.historyReplay));
    }
  }

  conversationState.addBlocks([{ type: 'meta', content: startupBannerText() }]);
  const initialIdentity = await systemIdentity.read();
  statusState.setIdentityName(identityNameFor(initialIdentity));
  if (initialIdentity.state === 'missing') {
    conversationState.addBlocks([{ type: 'meta', content: `\u26a0\ufe0f system identity file not found: ${initialIdentity.path} — continuing without it` }]);
  }
  // The name is display-only, so it updates live rather than only per query: a
  // watch on the owned identity file refreshes the status name whenever the file
  // changes. The body still rides runTurn (the only moment it reaches the model);
  // the name has no such constraint. The directory-watch also sees create,
  // delete, and inode-swapping editors, so deleted → name gone, restored → back.
  if (systemIdentity.path != null) {
    identityWatch = provider.resolve(IConfigWatcher).watch([systemIdentity.path], () => {
      void systemIdentity.read().then((read) => {
        statusState.setIdentityName(identityNameFor(read));
      });
    });
  }
  if (configOverride !== undefined) {
    conversationState.addBlocks([{ type: 'meta', content: formatEffectiveConfig({ ...configLoader.config, model: configFactory.getEffectiveModel() }, configOverride) }]);
  }
  statusState.setModel(configFactory.getEffectiveModel(), overrides.model != null);
  statusState.setShowConversationId(configLoader.config.statusBar.showConversationId);
  // Re-derive the status figures from the current id's audit, replacing the zero
  // state. A resumed id reads its usage back; a fresh id has no audit file, so it
  // reads empty. The configured TTL is passed for the legacy fallback that prices
  // any pre-existing flat-only lines of a resumed id.
  const auditStats = provider.resolve(AuditStats);
  statusState.resetTo(await auditStats.derive(session.id, configFactory.config.cacheTtl ?? CacheTtl.OneHour));
  host.renderNow();

  // --- Main loop ---

  const gitMonitor = provider.resolve(GitStateMonitor);
  const claudeMdLoader = provider.resolve(ClaudeMdLoader);
  const editorHandler = provider.resolve(EditorHandler);

  const workingDirectoryMoveHandler = provider.resolve(IWorkingDirectoryMoveHandler);
  workingDirectoryMoveHandler.wire();

  const runTurn = async (userInput: UserInput) => {
    // A turn is live: a concurrent wire `say` against the tip is rejected until it ends (cancel frees it).
    convServicer.setBusy(true);
    try {
      const claudeMdContent = configLoader.config.claudeMd.enabled ? await claudeMdLoader.getContent(configLoader.config.claudeMd.sources) : null;
      if (configFactory.needsSystemPromptResolve(session.id)) {
        await configFactory.resolveSystemPromptsFor(session.id);
      }
      configFactory.update(claudeMdContent);
      // Identity is a live mirror of disk: read fresh each query so an edit
      // propagates and a deletion degrades to nothing this turn.
      const identity = await systemIdentity.read();
      configFactory.updateIdentityBody(identity.state === 'present' ? identity.body : null);
      statusState.setIdentityName(identityNameFor(identity));

      const abortController = new AbortController();
      currentAbortController = abortController;
      statusState.setModel(configFactory.getEffectiveModel(), overrides.model != null);
      turnInProgress = true;
      await session.saveSession();
      const gitDelta = await gitMonitor.getDelta();
      // Re-scan the skill catalogue for this query; a non-null delta is injected as a persisted-leading
      // reminder on the user message. First scan of the process records the baseline and returns null.
      const skillDelta = await skillTracker.scanForDelta();
      const cwdDelta = cwdTracker.scanForDelta();
      const agentInput = buildRunAgentInput(userInput);
      await runAgent(
        queryRunner,
        agentInput,
        {
          conversationState,
          toolApprovalState,
          editorState,
          primaryViewState,
        },
        () => flushSealedToScroll(conversationState, terminalState, renderer, configLoader.config.markdown),
        transformToolResult,
        abortController,
        gitDelta,
        skillDelta,
        cwdDelta,
      );
      await gitMonitor.takeSnapshot();

      statusState.setModel(configFactory.getEffectiveModel(), overrides.model != null);
      await session.saveConversation();
      convChanges.flush(session.id);
      const pendingQueryClose = sdkEventBridge.takePendingQueryClose();
      if (pendingQueryClose != null) {
        convChanges.closeQuery(session.id, pendingQueryClose.queryId, pendingQueryClose.reason);
      }
    } catch (err) {
      logger.error('runTurn failed', err);
    } finally {
      turnInProgress = false;
      currentAbortController = null;
      convServicer.setBusy(false);
    }
  };

  const hasInitialTurn = initialFilePaths.length > 0 || initialPrompt != null;
  if (hasInitialTurn) {
    await runTurn(await buildInitialInput(decodedPrompt ?? '', initialFilePaths));
  }

  // The loop races the keyboard against the wire: whichever produces input first drives the turn. The
  // premise rule keeps them from colliding into two turns — a say is accepted only while idle (§1.4).
  const nextInput = async (): Promise<UserInput> => {
    const fromKeyboard = editorHandler.waitForInput();
    const fromWire = wireSayInbox.next().then((s): UserInput => ({ text: s.text, images: [], queryId: s.queryId, from: s.from }));
    return Promise.race([fromKeyboard, fromWire]);
  };

  while (true) {
    conversationState.markPromptStart();
    await runTurn(await nextInput());
  }
};
