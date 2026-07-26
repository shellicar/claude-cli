import { BOLD_WHITE, RESET } from '@shellicar/claude-core/ansi';
import type { ConfigWatchHandle } from '@shellicar/claude-core/Config/types';
import { dependsOn } from '@shellicar/core-di';
import { IAgentPresence } from '../agent/AgentPresence.js';
import { IAgentServicer } from '../agent/AgentServicer.js';
import { IBus } from '../bus/IBus.js';
import { logger } from '../logger.js';
import { IConversationSession } from '../model/ConversationSession.js';
import { HistorySweepScheduler } from '../persistence/HistorySweepScheduler.js';
import { TerminalRenderer } from '../view/TerminalRenderer.js';
import { IShutdownCoordinator } from './ShutdownCoordinator.js';
import { IWorkingDirectoryMoveHandler } from './WorkingDirectoryMoveHandler.js';

/** The sequence's contract; register abstract→concrete and depend on the abstract (DI rule). */
export abstract class IShutdownSequence {
  /** Hooks every trigger source (SIGINT, SIGTERM, a wire `drain`, and a keypress quit via
   *  `IShutdownCoordinator`) to the one `cleanup` sequence. Call once at startup. */
  public abstract wire(): void;
  /** The identity-file watch, present only once an identity is owned (set once `SessionActivator`
   *  and the initial identity read have run). `dispose`d on exit alongside everything else. */
  public abstract setIdentityWatch(handle: ConfigWatchHandle): void;
}

/**
 * The one clean-exit sequence, reachable from four trigger sources — SIGINT (a second press force-exits
 * with code 1), SIGTERM, a wire `drain` request, and a keypress quit (`QuitHandler` → `IShutdownCoordinator`).
 * Detaches the agent presence before the bus drops (so a clean exit reads as `detached`, never silence,
 * per agent-spec), stops the background sweep, disposes every live watch, and prints the resume hint.
 *
 * Was inline in `main.ts`'s `runApp` (the `cleanup` closure + four `process.on`/`onRequest` registrations),
 * coupling shutdown to whatever else main happened to have resolved by that point in the function. Extracted
 * so its dependencies are declared, not hand-resolved, and so `buildContainer(...).validate()` sees them.
 */
export class ShutdownSequence extends IShutdownSequence {
  @dependsOn(IAgentPresence) private readonly agentPresence!: IAgentPresence;
  @dependsOn(IAgentServicer) private readonly agentServicer!: IAgentServicer;
  @dependsOn(IBus) private readonly bus!: IBus;
  @dependsOn(IShutdownCoordinator) private readonly shutdownCoordinator!: IShutdownCoordinator;
  @dependsOn(TerminalRenderer) private readonly renderer!: TerminalRenderer;
  @dependsOn(IConversationSession) private readonly session!: IConversationSession;
  @dependsOn(IWorkingDirectoryMoveHandler) private readonly workingDirectoryMoveHandler!: IWorkingDirectoryMoveHandler;
  @dependsOn(HistorySweepScheduler) private readonly sweepScheduler!: HistorySweepScheduler;
  #identityWatch: ConfigWatchHandle | null = null;
  #sigintReceived = false;
  #cleanupStarted = false;

  public setIdentityWatch(handle: ConfigWatchHandle): void {
    // ConversationBootSequence sets this only after several awaits (reading the identity file), so a
    // trigger can already have run #cleanup by the time this call lands — #cleanup has already read
    // (and disposed) whatever #identityWatch held then, and will never run again (see #cleanupStarted),
    // so a watch arriving after that would never be disposed. Dispose it immediately instead of storing it.
    if (this.#cleanupStarted) {
      handle[Symbol.dispose]();
      return;
    }
    this.#identityWatch = handle;
  }

  public wire(): void {
    this.shutdownCoordinator.onRequest((reason) => void this.#cleanup(reason));
    this.agentServicer.on('drain', () => void this.#cleanup('drain'));
    process.on('SIGINT', () => {
      if (this.#sigintReceived) {
        process.exit(1);
      }
      this.#sigintReceived = true;
      void this.#cleanup('sigint');
    });
    process.on('SIGTERM', () => void this.#cleanup('sigterm'));
    process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
      logger.error('uncaughtException', err);
    });
    process.on('unhandledRejection', (reason) => {
      logger.error('unhandledRejection', reason);
    });
  }

  async #cleanup(_reason: string): Promise<void> {
    // Two trigger sources can fire together (e.g. a drain and a keypress quit landing in the same tick);
    // the sequence runs once, whichever trigger reaches this first.
    if (this.#cleanupStarted) {
      return;
    }
    this.#cleanupStarted = true;
    this.sweepScheduler.stop();
    // Released, deliberately (agent-spec): detach before the connection drops, so a clean exit reads as
    // `detached`, never as silence (which folds to stranded). Best-effort, bounded with the drain below.
    this.agentPresence.detach(this.session.id);
    this.agentPresence.stop();
    // Best-effort clean-exit announce, bounded so a slow or absent broker cannot hold the process open.
    // run_ended is clean-exit only; an ungraceful death is covered by heartbeat silence, not this.
    await Promise.race([this.bus.stop(), new Promise<void>((done) => setTimeout(done, 500).unref())]);
    // SIGINT exits abruptly (process.exit bypasses `using` disposal), so stop the config watches
    // explicitly. Disposes whichever watch is currently live — after a move it is a re-pointed watch,
    // not the one first built at startup.
    this.workingDirectoryMoveHandler.dispose();
    this.#identityWatch?.[Symbol.dispose]();
    this.renderer.exit();
    process.stdout.write(`Resume with: ${BOLD_WHITE}--resume ${this.session.id}${RESET}\n`);
    process.exit(0);
  }
}
