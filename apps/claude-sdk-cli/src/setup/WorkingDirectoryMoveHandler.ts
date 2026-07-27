import { basename } from 'node:path';
import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { ConfigReloader } from '@shellicar/claude-core/Config/ConfigReloader';
import { IConfigOptions } from '@shellicar/claude-core/Config/IConfigOptions';
import { IConfigWatcher } from '@shellicar/claude-core/Config/interfaces';
import type { ConfigWatchHandle } from '@shellicar/claude-core/Config/types';
import { IDurableConfigProvider } from '@shellicar/claude-sdk';
import { dependsOn } from '@shellicar/core-di';
import { IAgentPresence } from '../agent/AgentPresence.js';
import { ClaudeMdLoader } from '../ClaudeMdLoader.js';
import { logger } from '../logger.js';
import { IConversationSession } from '../model/ConversationSession.js';
import { StatusState } from '../model/StatusState.js';
import { IWorkingDirectory } from '../model/WorkingDirectory.js';
import { IPolicyNotifier } from './ConfigPolicyProvider.js';
import { IRulesConfigNotifier } from './ConfigRulesConfigProvider.js';

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
 * Owns the two watch handles across the move: each is disposed and replaced, not just re-read, so
 * `dispose()` (called from shutdown) always tears down whichever watch is currently live rather than
 * the one first built at startup. How a watch first arrived — injected at construction or created by
 * an earlier move — makes no difference: whatever is currently held is disposed and replaced the same
 * way every time, or a stale watch keeps firing on a directory the session has left.
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
  @dependsOn(IPolicyNotifier) private readonly policyNotifier!: IPolicyNotifier;
  @dependsOn(StatusState) private readonly statusState!: StatusState;
  @dependsOn(IAgentPresence) private readonly agentPresence!: IAgentPresence;
  @dependsOn(IDurableConfigProvider) private readonly configFactory!: IDurableConfigProvider;
  @dependsOn(ConfigLoader) private readonly configLoader!: ConfigLoader<any>;
  @dependsOn(ClaudeMdLoader) private readonly claudeMdLoader!: ClaudeMdLoader;
  @dependsOn(IConversationSession) private readonly session!: IConversationSession;
  // Not DI tokens (see container.ts): a re-pointable watch isn't a singleton value, so this handler
  // constructs both itself, in wire(), and owns their whole lifecycle from there — construction,
  // every re-point, and final disposal — with no other holder anywhere in the container.
  private configWatch: ConfigWatchHandle | null = null;
  private rulesConfigWatch: ConfigWatchHandle | null = null;
  private policyWatch: ConfigWatchHandle | null = null;

  public wire(): void {
    this.configWatch = this.configWatcher.watch(this.configOptions.paths, () => this.configReloader.scheduleReload());
    this.rulesConfigWatch = this.configWatcher.watch(this.configOptions.paths, () => this.rulesConfigNotifier.refresh());
    this.policyWatch = this.configWatcher.watch(this.configOptions.paths, () => this.policyNotifier.refresh());
    this.workingDirectory.on('change', (cwd) => {
      this.configWatch?.[Symbol.dispose]();
      this.configWatch = this.configWatcher.watch(this.configOptions.paths, () => this.configReloader.scheduleReload());
      this.configReloader.reload();
      this.rulesConfigWatch?.[Symbol.dispose]();
      this.rulesConfigWatch = this.configWatcher.watch(this.configOptions.paths, () => this.rulesConfigNotifier.refresh());
      this.rulesConfigNotifier.refresh();
      this.policyWatch?.[Symbol.dispose]();
      this.policyWatch = this.configWatcher.watch(this.configOptions.paths, () => this.policyNotifier.refresh());
      this.policyNotifier.refresh();
      this.statusState.setCwdBasename(basename(cwd));
      void this.#reloadPromptsAfterMove();
      // The move landed: re-publish `attached` at the new cwd, last-write-wins (agent-spec, chdir). Fires
      // for both a local /cd and a `chdir` request — WorkingDirectory.change is the one authoritative path.
      this.agentPresence.attach(this.session.id, cwd);
    });
  }

  /** Disposes whichever watch is currently live — the one first built at startup, or a later
   *  re-point, whichever the process is holding when it exits. A no-op if wire() never ran (nothing
   *  in the class enforces wire-before-dispose, and a shutdown trigger can fire before startup
   *  wiring completes), since there is then nothing to dispose. */
  public dispose(): void {
    this.configWatch?.[Symbol.dispose]();
    this.rulesConfigWatch?.[Symbol.dispose]();
    this.policyWatch?.[Symbol.dispose]();
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
