import { IAgentContext } from '@shellicar/claude-core/fs/IAgentContext';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { dependsOn } from '@shellicar/core-di';

const CWD_HEADER = 'The current working directory is:';
const CWD_CHANGED_HEADER = 'The working directory has changed:';

/**
 * Emits a persisted-leading `<system-reminder>` naming the cwd: the current directory on the first query,
 * and the from/to when it moves mid-session. cwd is the frame every relative path resolves against, so it
 * is stated up front rather than left for the model to infer.
 */
export class CwdTracker {
  @dependsOn(IAgentContext) private readonly agentContext!: IAgentContext;
  @dependsOn(ILogger) private readonly logger!: ILogger;

  #lastCwd: string | null = null;

  /** Return the cwd reminder text for this query, or null when there is nothing to announce. */
  public scanForDelta(): string | null {
    const live = this.agentContext.cwd();

    if (this.#lastCwd == null) {
      this.#lastCwd = live;
      this.logger.info('cwd announced', { cwd: live });
      return `${CWD_HEADER}\n\n${live}`;
    }

    if (live !== this.#lastCwd) {
      const previous = this.#lastCwd;
      this.#lastCwd = live;
      this.logger.info('cwd changed', { from: previous, to: live });
      return `${CWD_CHANGED_HEADER}\n\nfrom: ${previous}\nto: ${live}`;
    }

    return null;
  }
}
