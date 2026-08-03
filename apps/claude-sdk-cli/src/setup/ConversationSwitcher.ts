import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { CacheTtl, IConversation } from '@shellicar/claude-sdk';
import { dependsOn } from '@shellicar/core-di';
import { AuditStats } from '../AuditStats.js';
import { IAgentPresence } from '../agent/AgentPresence.js';
import type { sdkConfigSchema } from '../cli-config/schema.js';
import { IConvServe } from '../conv/ConvServe.js';
import { IConversationSession } from '../model/ConversationSession.js';
import { IConversationState } from '../model/ConversationState.js';
import { ISystemIdentity } from '../model/ISystemIdentity.js';
import { IPrimaryViewState } from '../model/PrimaryViewState.js';
import { StatusState } from '../model/StatusState.js';
import { replayHistory } from '../replayHistory.js';
import { IWorkspace, scratchpadUnavailableNotice } from '../workspace/Workspace.js';

/** The switcher's contract; register abstract→concrete and depend on the abstract (DI rule). */
export abstract class IConversationSwitcher {
  public abstract createNew(): Promise<void>;
  public abstract switchTo(id: string): Promise<void>;
}

/**
 * Moves the process from one conversation to another, in place. Both entries — a fresh id
 * (`/new`) and an existing one (the conversation view) — run the same lifecycle: re-point the
 * wire serve, move the agent attachment, settle the system identity, reset the transcript, and
 * re-derive the status figures from the new id's audit.
 *
 * The two differ in one place: a fresh id starts empty and INHERITS the running identity, while
 * an existing one loads its own history and the identity it already owns.
 *
 * Neither re-resolves the system prompts. That is keyed by session id, but TurnCoordinator
 * already checks `needsSystemPromptResolve` before every turn, so the move is picked up there
 * rather than duplicated here.
 */
export class ConversationSwitcher extends IConversationSwitcher {
  @dependsOn(IConversationSession) private readonly session!: IConversationSession;
  @dependsOn(IConversationState) private readonly conversationState!: IConversationState;
  @dependsOn(ISystemIdentity) private readonly systemIdentity!: ISystemIdentity;
  @dependsOn(IAgentPresence) private readonly agentPresence!: IAgentPresence;
  @dependsOn(IConvServe) private readonly convServe!: IConvServe;
  @dependsOn(AuditStats) private readonly auditStats!: AuditStats;
  @dependsOn(StatusState) private readonly statusState!: StatusState;
  @dependsOn(IFileSystem) private readonly fs!: IFileSystem;
  @dependsOn(IConversation) private readonly conversation!: IConversation;
  @dependsOn(IPrimaryViewState) private readonly primaryViewState!: IPrimaryViewState;
  @dependsOn(ConfigLoader) private readonly configLoader!: ConfigLoader<typeof sdkConfigSchema>;
  @dependsOn(IWorkspace) private readonly workspace!: IWorkspace;
  public async createNew(): Promise<void> {
    if (this.primaryViewState.conversationMoving) {
      return;
    }
    await this.#move(() => this.#createNew());
  }

  public async switchTo(id: string): Promise<void> {
    if (this.primaryViewState.conversationMoving || id === this.session.id) {
      return;
    }
    await this.#move(() => this.#switchTo(id));
  }

  /**
   * Holds the in-flight flag across one move.
   *
   * A move is a transaction: the second of two overlapping ones would rebind the wire serve and the
   * agent attachment against a conversation the first has not finished adopting. The flag lives in the
   * store rather than here so the guard and the views that grey what a move makes unavailable read one
   * value, not two kept in step by hand.
   */
  async #move(run: () => Promise<void>): Promise<void> {
    this.primaryViewState.setConversationMoving(true);
    try {
      await run();
    } finally {
      this.primaryViewState.setConversationMoving(false);
    }
  }

  async #createNew(): Promise<void> {
    const previousId = this.session.id;
    await this.session.createNew();
    this.#rebind(previousId);
    this.systemIdentity.inherit(this.session.id);
    this.conversationState.clear();
    // After the transcript is cleared, or the notice would be cleared with it.
    await this.#resolveWorkspace();
    await this.#resetStatus();
  }

  async #switchTo(id: string): Promise<void> {
    const previousId = this.session.id;
    // Persist the conversation being left before its history is replaced in memory: the
    // transcript is written per turn, but the leaving turn's tip may not have been saved yet.
    await this.session.saveConversation();
    await this.session.resume(id);
    await this.session.saveSession();
    this.#rebind(previousId);
    this.systemIdentity.load(this.session.id);
    this.conversationState.clear();
    this.#replayHistory();
    // After the transcript is rebuilt, or the notice would be cleared with it.
    await this.#resolveWorkspace();
    await this.#resetStatus();
  }

  /**
   * The scratchpad is per conversation, so it is created and checked whenever the conversation
   * changes and never per turn. A refusal is reported and the scratchpad simply goes unused: it is a
   * convenience, and losing it is not a reason to fail the move.
   */
  async #resolveWorkspace(): Promise<void> {
    const refusal = await this.workspace.resolve();
    if (refusal != null) {
      this.conversationState.spliceNotice(scratchpadUnavailableNotice(refusal));
    }
  }

  /** Puts the adopted conversation on screen. Loading it makes the model aware of it; without this the
   *  operator arrives at what looks like an empty conversation. Same replay the boot sequence runs when
   *  the process starts on a resumed conversation. */
  #replayHistory(): void {
    if (!this.configLoader.config.historyReplay.enabled) {
      return;
    }
    const history = this.conversation.messages;
    if (history.length === 0) {
      return;
    }
    this.conversationState.addBlocks(replayHistory(history, this.configLoader.config.historyReplay));
  }

  /** A run is process + conversation, so a move re-points the addressable subject: the wire serve
   *  binds to the new id, and the agent attachment detaches the old and attaches the new. */
  #rebind(previousId: string): void {
    this.convServe.bind(this.session.id);
    this.agentPresence.detach(previousId);
    this.agentPresence.attach(this.session.id, this.fs.cwd());
  }

  /** Re-derive the status figures for the current id. A fresh id has no audit file, so this reads
   *  empty and the "clear on new" behaviour falls out of the single id-keyed rule. The TTL is
   *  inert except for a legacy flat-only audit line, so the default is passed rather than
   *  threading the config provider. */
  async #resetStatus(): Promise<void> {
    this.statusState.resetTo(await this.auditStats.derive(this.session.id, CacheTtl.OneHour));
  }
}
