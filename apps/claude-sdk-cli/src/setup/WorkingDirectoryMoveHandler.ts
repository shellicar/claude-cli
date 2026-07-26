import { basename } from 'node:path';
import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { ConfigReloader } from '@shellicar/claude-core/Config/ConfigReloader';
import { IConfigOptions } from '@shellicar/claude-core/Config/IConfigOptions';
import { IConfigWatcher } from '@shellicar/claude-core/Config/interfaces';
import { ConfigWatchHandle } from '@shellicar/claude-core/Config/types';
import { IDurableConfigProvider } from '@shellicar/claude-sdk';
import { dependsOn } from '@shellicar/core-di';
import { IAgentPresence } from '../agent/AgentPresence.js';
import { ClaudeMdLoader } from '../ClaudeMdLoader.js';
import { logger } from '../logger.js';
import { IConversationSession } from '../model/ConversationSession.js';
import { StatusState } from '../model/StatusState.js';
import { IWorkingDirectory } from '../model/WorkingDirectory.js';
import { IRulesConfigNotifier, RulesConfigWatchHandle } from './ConfigRulesConfigProvider.js';

/** The handler's contract; register abstract→concrete and depend on the abstract (DI rule). */
export abstract class IWorkingDirectoryMoveHandler {
  public abstract wire(): void;
  public abstract dispose(): void;
}

/**
 * Reacts to a successful `cd` (local `/cd` or a wire `chdir`, both funnelled through the one
 * authoritative `WorkingDirectory.change`): re-points the whole-document config watch and the
 * independent tools.rules watch at the new directory and reloads both immediately, reloads
 * SYSTEM.md/CLAUDE.md so their content follows the cwd, refreshes the status basename, and
 * re-publishes `attached` at the new cwd (agent-spec).
 *
 * Owns the two watch handles across the move: each is replaced, not just re-read, so a later
 * `/cd`/`chdir` observes the new directory's local config from then on. A superseded watch is not
 * disposed at move time — disposing the container-registered starting handle would make that DI
 * token unusable to any other consumer holding the same reference for the rest of the session, for a
 * saving that only avoids one harmless extra fs watch on a directory the session has left. `dispose()`
 * (called from shutdown) tears down whichever watch is current when the process exits; process exit
 * itself reclaims any earlier, superseded watch.
 *
 * Was inline in `main.ts`'s `runApp`, coupling this concern to whatever else happened to be resolved
 * around it. Extracted so its dependencies are declared, not hand-resolved, and so `buildContainer(...)
 * .validate()` actually sees this wiring.
 */
export class WorkingDirectoryMoveHandler extends IWorkingDirectoryMoveHandler {
  @dependsOn(IWorkingDirectory) private readonly workingDirectory!: IWorkingDirectory;
  @dependsOn(IConfigWatcher) private readonly configWatcher!: IConfigWatcher;
  @dependsOn(IConfigOptions) private readonly configOptions!: IConfigOptions;
  @dependsOn(ConfigReloader) private readonly configReloader!: ConfigReloader;
  @dependsOn(IRulesConfigNotifier) private readonly rulesConfigNotifier!: IRulesConfigNotifier;
  @dependsOn(StatusState) private readonly statusState!: StatusState;
  @dependsOn(IAgentPresence) private readonly agentPresence!: IAgentPresence;
  @dependsOn(IDurableConfigProvider) private readonly configFactory!: IDurableConfigProvider;
  @dependsOn(ConfigLoader) private readonly configLoader!: ConfigLoader<any>;
  @dependsOn(ClaudeMdLoader) private readonly claudeMdLoader!: ClaudeMdLoader;
  @dependsOn(IConversationSession) private readonly session!: IConversationSession;
  @dependsOn(ConfigWatchHandle) private configWatch!: ConfigWatchHandle;
  @dependsOn(RulesConfigWatchHandle) private rulesConfigWatch!: ConfigWatchHandle;

  public wire(): void {
    this.workingDirectory.on('change', (cwd) => {
      this.configWatch = this.configWatcher.watch(this.configOptions.paths, () => this.configReloader.scheduleReload());
      this.configReloader.reload();
      this.rulesConfigWatch = this.configWatcher.watch(this.configOptions.paths, () => this.rulesConfigNotifier.refresh());
      this.rulesConfigNotifier.refresh();
      this.statusState.setCwdBasename(basename(cwd));
      void this.#reloadPromptsAfterMove();
      // The move landed: re-publish `attached` at the new cwd, last-write-wins (agent-spec, chdir). Fires
      // for both a local /cd and a `chdir` request — WorkingDirectory.change is the one authoritative path.
      this.agentPresence.attach(this.session.id, cwd);
    });
  }

  /** Disposes whichever watch is currently live — the one first built at startup, or a later
   *  re-point, whichever the process is holding when it exits. */
  public dispose(): void {
    this.configWatch[Symbol.dispose]();
    this.rulesConfigWatch[Symbol.dispose]();
  }

  async #reloadPromptsAfterMove(): Promise<void> {
    try {
      await this.configFactory.resolveSystemPromptsFor(this.session.id);
      const claudeMdContent = this.configLoader.config.claudeMd.enabled ? await this.claudeMdLoader.getContent(this.configLoader.config.claudeMd.sources) : null;
      this.configFactory.update(claudeMdContent);
    } catch (err) {
      logger.error('failed to reload prompt files after directory change', err);
    }
  }
}
