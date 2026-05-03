/** Producer-side surface. Owns the send path and channel lifecycle. */
export interface IPublisher<T> {
  /** Enqueue msg for delivery to all subscribers. Fire-and-forget. */
  send(msg: T): void;
  /** Signal shutdown. Subsequent send() calls throw. */
  close(): void;
  /**
   * Resolves when all subscriber queues are empty and all in-flight handlers
   * have settled. Resolves immediately if already idle. Multiple concurrent
   * calls each get their own promise; all resolve together when idle.
   */
  drain(): Promise<void>;
}

/** Consumer-side surface. Registers async-ordered handlers. */
export interface ISubscriber<T> {
  /**
   * Register a handler. The channel awaits each handler's returned promise
   * before delivering the next message to this subscriber. Multiple
   * subscribers are independent: each has its own FIFO queue and pump.
   */
  subscribe(handler: (msg: T) => Promise<void>): void;
}

type SubscriberState<T> = {
  queue: T[];
  running: boolean;
  handler: (msg: T) => Promise<void>;
};

export class ControlChannel<T> implements IPublisher<T>, ISubscriber<T> {
  readonly #subscribers: SubscriberState<T>[] = [];
  readonly #drainWaiters: Array<() => void> = [];
  #closed = false;

  public send(msg: T): void {
    if (this.#closed) {
      throw new Error('Cannot send on a closed ControlChannel');
    }
    for (const sub of this.#subscribers) {
      sub.queue.push(msg);
      if (!sub.running) {
        this.#startPump(sub);
      }
    }
  }

  public subscribe(handler: (msg: T) => Promise<void>): void {
    this.#subscribers.push({ queue: [], running: false, handler });
  }

  public close(): void {
    this.#closed = true;
  }

  public drain(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this.#isIdle()) {
        resolve();
        return;
      }
      this.#drainWaiters.push(resolve);
    });
  }

  #isIdle(): boolean {
    return this.#subscribers.every((sub) => sub.queue.length === 0 && !sub.running);
  }

  #startPump(sub: SubscriberState<T>): void {
    sub.running = true;
    void this.#runPump(sub);
  }

  async #runPump(sub: SubscriberState<T>): Promise<void> {
    while (sub.queue.length > 0) {
      const msg = sub.queue.shift();
      if (msg === undefined) {
        break;
      }
      try {
        await sub.handler(msg);
      } catch {
        // Swallow: one handler failure must not stop message delivery.
      }
    }
    sub.running = false;
    if (this.#isIdle()) {
      const waiters = this.#drainWaiters.splice(0);
      for (const w of waiters) {
        w();
      }
    }
  }
}
