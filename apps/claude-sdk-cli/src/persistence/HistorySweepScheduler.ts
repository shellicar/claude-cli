import type { IHistorySweeper } from '@shellicar/claude-core/history/interfaces';

type SweepLogger = {
  error: (message: string, ...meta: unknown[]) => void;
};

export type HistorySweepSchedulerOptions = {
  /** Shortest wait between passes, in milliseconds. */
  minDelayMs: number;
  /** Longest wait between passes, in milliseconds. The wait is uniform in `[minDelayMs, maxDelayMs)`. */
  maxDelayMs: number;
  /** Randomness source for the jitter; defaults to `Math.random`. Injected so a test can make the delay deterministic. */
  random?: () => number;
};

/**
 * Drives the dedup sweep on a jittered timer. Each tick runs one `sweep` pass, then arms the next tick after a random
 * wait in `[minDelayMs, maxDelayMs)`. The jitter (including the very first wait) spreads many CLIs' passes out so they
 * do not all reach for the lease at once; a pass that finds the lease held simply does nothing, so an overlap is safe
 * either way.
 *
 * The timer is `unref`'d, so it never keeps the process alive on its own. A sweep is best-effort maintenance over a
 * rebuildable index: a pass that throws is logged (through the app logger — never raw console, which corrupts the
 * TUI) and swallowed, and the loop continues, so a bad pass can never take the conversation down.
 */
export class HistorySweepScheduler {
  readonly #sweeper: IHistorySweeper;
  readonly #logger: SweepLogger;
  readonly #minDelayMs: number;
  readonly #spanMs: number;
  readonly #random: () => number;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #running = false;

  public constructor(sweeper: IHistorySweeper, logger: SweepLogger, options: HistorySweepSchedulerOptions) {
    this.#sweeper = sweeper;
    this.#logger = logger;
    this.#minDelayMs = options.minDelayMs;
    this.#spanMs = options.maxDelayMs - options.minDelayMs;
    this.#random = options.random ?? Math.random;
  }

  public start(): void {
    if (this.#running) {
      return;
    }
    this.#running = true;
    this.#arm();
  }

  public stop(): void {
    this.#running = false;
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  /** The next jittered wait in milliseconds. */
  public nextDelayMs(): number {
    return this.#minDelayMs + Math.floor(this.#random() * this.#spanMs);
  }

  #arm(): void {
    this.#timer = setTimeout(() => this.#tick(), this.nextDelayMs());
    this.#timer.unref();
  }

  #tick(): void {
    try {
      this.#sweeper.sweep();
    } catch (error) {
      this.#logger.error('history sweep pass failed', error);
    }
    if (this.#running) {
      this.#arm();
    }
  }
}
