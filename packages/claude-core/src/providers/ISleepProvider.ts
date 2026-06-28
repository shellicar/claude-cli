/**
 * Abort-aware sleep. Resolves immediately if the signal is already aborted or
 * fires before the delay elapses, so a Ctrl-C during a long backoff cancels at
 * once. Replaces the `sleep = defaultSleep` constructor default.
 */
export abstract class ISleepProvider {
  public abstract sleep(ms: number, signal: AbortSignal): Promise<void>;
}
