import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { IDurableConfigProvider, QueryRunner } from '@shellicar/claude-sdk';
import { dependsOn } from '@shellicar/core-di';
import { ClaudeMdLoader } from '../ClaudeMdLoader.js';
import { IConvChangePublisher } from '../conv/ConvChangePublisher.js';
import { IConvServicer } from '../conv/ConvServicer.js';
import { GitStateMonitor } from '../GitStateMonitor.js';
import { logger } from '../logger.js';
import { IConversationSession } from '../model/ConversationSession.js';
import { IConversationState } from '../model/ConversationState.js';
import { IEditorBuffer } from '../model/EditorBuffer.js';
import { ISystemIdentity, identityNameFor } from '../model/ISystemIdentity.js';
import { IPrimaryViewState } from '../model/PrimaryViewState.js';
import { StatusState } from '../model/StatusState.js';
import { ITerminalState } from '../model/TerminalState.js';
import { IToolApprovalState } from '../model/ToolApprovalState.js';
import { buildRunAgentInput, runAgent, type UserInput } from '../runAgent.js';
import { flushSealedToScroll } from '../view/flushSealedToScroll.js';
import { TerminalRenderer } from '../view/TerminalRenderer.js';
import { AppToolsService } from './AppToolsService.js';
import { ICacheWarning, liveCacheParameters } from './CacheWarning.js';
import { CwdTracker } from './CwdTracker.js';
import { ModelOverrides } from './ModelOverrides.js';
import { ISdkEventBridge } from './SdkEventBridge.js';
import { SkillCatalogueTracker } from './SkillCatalogueTracker.js';

/** The coordinator's contract; register abstract→concrete and depend on the abstract (DI rule). */
export abstract class ITurnCoordinator {
  /** Subscribes the scroll flush to conversation changes: any block sealing at any time (not just
   *  turn boundaries) is written to scrollback. Call once at startup, before any turn runs. */
  public abstract wire(): void;
  /** Run one turn: git/skill/cwd delta collection, save-before-send, the agent call, save-after,
   *  and query-close bookkeeping. Never throws — a failure is logged and swallowed, matching the
   *  main loop's original contract (one bad turn must not crash the process). */
  public abstract runTurn(userInput: UserInput): Promise<void>;
  /** True for the extent of a turn — from just before the request starts to just after it settles.
   *  Read by the config-reload handler to defer a live status update until the turn between requests. */
  public abstract get inProgress(): boolean;
  /** True while a turn's `AbortController` is live — gates whether a query-cancel has anything to abort. */
  public abstract hasActiveTurn(): boolean;
  /** Aborts the in-flight turn's request, if any. A no-op when no turn is running. */
  public abstract abort(): void;
}

/**
 * Runs one turn: the delta collection (git/skill/cwd), the save-before-send (crash-recoverable: a
 * death mid-response still leaves the sent user message on disk), the agent call itself, the
 * save-after, and the query-close bookkeeping (`convChanges.closeQuery`, fed by the pending close
 * `SdkEventBridge` recognised off telemetry during the turn).
 *
 * Was inline in `main.ts`'s `runApp` (the `runTurn` closure) — main resolved every dependency itself.
 * Extracted so this seam's dependencies are declared, not hand-resolved, and so
 * `buildContainer(...).validate()` sees them.
 */
export class TurnCoordinator extends ITurnCoordinator {
  @dependsOn(IConvServicer) private readonly convServicer!: IConvServicer;
  @dependsOn(ConfigLoader) private readonly configLoader!: ConfigLoader<any>;
  @dependsOn(IDurableConfigProvider) private readonly configFactory!: IDurableConfigProvider;
  @dependsOn(ISystemIdentity) private readonly systemIdentity!: ISystemIdentity;
  @dependsOn(StatusState) private readonly statusState!: StatusState;
  @dependsOn(ModelOverrides) private readonly overrides!: ModelOverrides;
  @dependsOn(IConversationSession) private readonly session!: IConversationSession;
  @dependsOn(GitStateMonitor) private readonly gitMonitor!: GitStateMonitor;
  @dependsOn(SkillCatalogueTracker) private readonly skillTracker!: SkillCatalogueTracker;
  @dependsOn(CwdTracker) private readonly cwdTracker!: CwdTracker;
  @dependsOn(QueryRunner) private readonly queryRunner!: QueryRunner;
  @dependsOn(IConversationState) private readonly conversationState!: IConversationState;
  @dependsOn(IToolApprovalState) private readonly toolApprovalState!: IToolApprovalState;
  @dependsOn(IEditorBuffer) private readonly editorBuffer!: IEditorBuffer;
  @dependsOn(IPrimaryViewState) private readonly primaryViewState!: IPrimaryViewState;
  @dependsOn(ITerminalState) private readonly terminalState!: ITerminalState;
  @dependsOn(TerminalRenderer) private readonly renderer!: TerminalRenderer;
  @dependsOn(ClaudeMdLoader) private readonly claudeMdLoader!: ClaudeMdLoader;
  @dependsOn(AppToolsService) private readonly appTools!: AppToolsService;
  @dependsOn(IConvChangePublisher) private readonly convChanges!: IConvChangePublisher;
  @dependsOn(ISdkEventBridge) private readonly sdkEventBridge!: ISdkEventBridge;
  @dependsOn(ICacheWarning) private readonly cacheWarning!: ICacheWarning;
  #currentAbortController: AbortController | null = null;
  #turnInProgress = false;

  public get inProgress(): boolean {
    return this.#turnInProgress;
  }

  public hasActiveTurn(): boolean {
    return this.#currentAbortController != null;
  }

  public abort(): void {
    this.#currentAbortController?.abort();
  }

  #flushToScroll = (): void => {
    flushSealedToScroll(this.conversationState, this.terminalState, this.renderer, this.configLoader.config.markdown);
  };

  public wire(): void {
    this.conversationState.on('change', this.#flushToScroll);
  }

  #transformToolResult = (toolName: string, output: unknown): unknown => {
    const result = this.appTools.refTransform(toolName, output);
    if (toolName !== 'Ref') {
      const bytes = (typeof result === 'string' ? result : JSON.stringify(result)).length;
      logger.debug('tool_result_size', { name: toolName, bytes });
    }
    return result;
  };

  public async runTurn(userInput: UserInput): Promise<void> {
    // A turn is live: a concurrent wire `say` against the tip is rejected until it ends (cancel frees it).
    this.convServicer.setBusy(true);
    try {
      const claudeMdContent = this.configLoader.config.claudeMd.enabled ? await this.claudeMdLoader.getContent(this.configLoader.config.claudeMd.sources) : null;
      if (this.configFactory.needsSystemPromptResolve(this.session.id)) {
        await this.configFactory.resolveSystemPromptsFor(this.session.id);
      }
      this.configFactory.update(claudeMdContent);
      // Identity is a live mirror of disk: read fresh each query so an edit
      // propagates and a deletion degrades to nothing this turn.
      const identity = await this.systemIdentity.read();
      this.configFactory.updateIdentityBody(identity.state === 'present' ? identity.body : null);
      this.statusState.setIdentityName(identityNameFor(identity));

      const abortController = new AbortController();
      this.#currentAbortController = abortController;
      this.statusState.setModel(this.configFactory.getEffectiveModel(), this.overrides.model != null);
      this.#turnInProgress = true;
      await this.session.saveSession();
      const gitDelta = await this.gitMonitor.getDelta();
      // Re-scan the skill catalogue for this query; a non-null delta is injected as a persisted-leading
      // reminder on the user message. First scan of the process records the baseline and returns null.
      const skillDelta = await this.skillTracker.scanForDelta();
      const cwdDelta = this.cwdTracker.scanForDelta();
      const agentInput = buildRunAgentInput(userInput);
      // Noted on the way out rather than on the way back. The API has processed the prefix and written
      // the cache before a stream can be cut off, so an aborted turn has still moved what the cache is
      // keyed on; recording after the response would leave the next turn measuring against a stale value
      // and warning about a cost already paid. These are also the parameters this turn's audit line carries.
      this.overrides.markSent(liveCacheParameters(this.configFactory));
      this.cacheWarning.refresh();
      await runAgent(
        this.queryRunner,
        agentInput,
        {
          conversationState: this.conversationState,
          toolApprovalState: this.toolApprovalState,
          editorBuffer: this.editorBuffer,
          primaryViewState: this.primaryViewState,
        },
        this.#transformToolResult,
        abortController,
        { git: gitDelta, skill: skillDelta, cwd: cwdDelta },
      );
      await this.gitMonitor.takeSnapshot();
      this.statusState.setModel(this.configFactory.getEffectiveModel(), this.overrides.model != null);
      await this.session.saveConversation();
      this.convChanges.flush(this.session.id);
      const pendingQueryClose = this.sdkEventBridge.takePendingQueryClose();
      if (pendingQueryClose != null) {
        this.convChanges.closeQuery(this.session.id, pendingQueryClose.queryId, pendingQueryClose.reason);
      }
    } catch (err) {
      logger.error('runTurn failed', err);
    } finally {
      this.#turnInProgress = false;
      this.#currentAbortController = null;
      this.convServicer.setBusy(false);
    }
  }
}
