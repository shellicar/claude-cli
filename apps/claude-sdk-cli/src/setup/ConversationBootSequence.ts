import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { IConfigWatcher } from '@shellicar/claude-core/Config/interfaces';
import { CacheTtl, IConversation, IDurableConfigProvider } from '@shellicar/claude-sdk';
import { dependsOn } from '@shellicar/core-di';
import { AuditStats } from '../AuditStats.js';
import { ViewHost } from '../app/ViewHost.js';
import { formatEffectiveConfig } from '../cli-config/formatEffectiveConfig.js';
import { startupBannerText } from '../help.js';
import { IConversationSession } from '../model/ConversationSession.js';
import { IConversationState } from '../model/ConversationState.js';
import { ISystemIdentity, identityNameFor } from '../model/ISystemIdentity.js';
import { StatusState } from '../model/StatusState.js';
import { HistorySweepScheduler } from '../persistence/HistorySweepScheduler.js';
import { replayHistory } from '../replayHistory.js';
import { IWorkspace } from '../workspace/Workspace.js';
import { ModelOverrides } from './ModelOverrides.js';
import { ISdkEventBridge } from './SdkEventBridge.js';
import { IShutdownSequence } from './ShutdownSequence.js';

/** The boot sequence's contract; register abstract→concrete and depend on the abstract (DI rule). */
export abstract class IConversationBootSequence {
  public abstract run(configOverride: Record<string, unknown> | undefined): Promise<void>;
}

/**
 * The one-time async startup that gets the conversation onto the screen: starts the background
 * history-dedup sweep, resolves the system prompts and skill catalogue for the session, wires the
 * SDK event bridge, replays prior history if enabled, adds the startup banner, reads the system
 * identity (and watches it for live edits), notes an active `--config` override, and derives the
 * status bar's initial usage figures from the session's audit.
 *
 * Was inline in `main.ts`'s `runApp`. Extracted so its dependencies are declared, not hand-resolved,
 * and so `buildContainer(...).validate()` sees this wiring.
 */
export class ConversationBootSequence extends IConversationBootSequence {
  @dependsOn(HistorySweepScheduler) private readonly historySweepScheduler!: HistorySweepScheduler;
  @dependsOn(IDurableConfigProvider) private readonly configFactory!: IDurableConfigProvider;
  @dependsOn(ISdkEventBridge) private readonly sdkEventBridge!: ISdkEventBridge;
  @dependsOn(IConversation) private readonly conversation!: IConversation;
  @dependsOn(ConfigLoader) private readonly configLoader!: ConfigLoader<any>;
  @dependsOn(IWorkspace) private readonly workspace!: IWorkspace;
  @dependsOn(IConversationState) private readonly conversationState!: IConversationState;
  @dependsOn(ISystemIdentity) private readonly systemIdentity!: ISystemIdentity;
  @dependsOn(StatusState) private readonly statusState!: StatusState;
  @dependsOn(IConfigWatcher) private readonly configWatcher!: IConfigWatcher;
  @dependsOn(IShutdownSequence) private readonly shutdownSequence!: IShutdownSequence;
  @dependsOn(ModelOverrides) private readonly overrides!: ModelOverrides;
  @dependsOn(IConversationSession) private readonly session!: IConversationSession;
  @dependsOn(AuditStats) private readonly auditStats!: AuditStats;
  @dependsOn(ViewHost) private readonly host!: ViewHost;

  public async run(configOverride: Record<string, unknown> | undefined): Promise<void> {
    // Background dedup maintenance over history.db. The scheduler jitters each pass (5–10 min apart) so many CLIs on
    // the machine do not reach for the sweep lease together, and its timer is unref'd so it never holds the process
    // open; ShutdownSequence stops it on exit. A pass is best-effort over a rebuildable index — a failure is logged
    // and swallowed.
    this.historySweepScheduler.start();

    // System prompts are read from SYSTEM.md (async file I/O over the constructed factory). Resolve once for this
    // session here; TurnCoordinator re-resolves on a session change. The config getter reads the resolved prompts
    // each turn.
    await this.configFactory.resolveSystemPromptsFor(this.session.id);
    // Scan the configured skill roots once and hold the catalogue reminder. Static for the session; it rides
    // cachedReminders (see DurableConfigFactory.update) into the first user message and post-compact.
    await this.configFactory.resolveSkillCatalogue();
    // The scratchpad belongs to the conversation, so it is created and checked here and whenever the
    // conversation changes, never per turn. A refusal is reported and it simply goes unused.
    const workspaceRefusal = await this.workspace.resolve();
    if (workspaceRefusal != null) {
      this.conversationState.spliceNotice(`scratchpad unavailable: ${workspaceRefusal}`);
    }
    this.sdkEventBridge.wire();

    if (this.configLoader.config.historyReplay.enabled) {
      const history = this.conversation.messages;
      if (history.length > 0) {
        this.conversationState.addBlocks(replayHistory(history, this.configLoader.config.historyReplay));
      }
    }

    this.conversationState.addBlocks([{ type: 'meta', content: startupBannerText() }]);
    const initialIdentity = await this.systemIdentity.read();
    this.statusState.setIdentityName(identityNameFor(initialIdentity));
    if (initialIdentity.state === 'missing') {
      this.conversationState.addBlocks([{ type: 'meta', content: `\u26a0\ufe0f system identity file not found: ${initialIdentity.path} — continuing without it` }]);
    }
    // The name is display-only, so it updates live rather than only per query: a watch on the owned identity file
    // refreshes the status name whenever the file changes. The body still rides a turn (the only moment it reaches
    // the model); the name has no such constraint. The directory-watch also sees create, delete, and inode-swapping
    // editors, so deleted → name gone, restored → back.
    if (this.systemIdentity.path != null) {
      const identityWatch = this.configWatcher.watch([this.systemIdentity.path], () => {
        void this.systemIdentity.read().then((read) => {
          this.statusState.setIdentityName(identityNameFor(read));
        });
      });
      this.shutdownSequence.setIdentityWatch(identityWatch);
    }
    if (configOverride !== undefined) {
      this.conversationState.addBlocks([{ type: 'meta', content: formatEffectiveConfig({ ...this.configLoader.config, model: this.configFactory.getEffectiveModel() }, configOverride) }]);
    }
    this.statusState.setModel(this.configFactory.getEffectiveModel(), this.overrides.model != null);
    this.statusState.setShowConversationId(this.configLoader.config.statusBar.showConversationId);
    // Re-derive the status figures from the current id's audit, replacing the zero state. A resumed id reads its
    // usage back; a fresh id has no audit file, so it reads empty. The configured TTL is passed for the legacy
    // fallback that prices any pre-existing flat-only lines of a resumed id.
    this.statusState.resetTo(await this.auditStats.derive(this.session.id, this.configFactory.config.cacheTtl ?? CacheTtl.OneHour));
    this.host.renderNow();
  }
}
