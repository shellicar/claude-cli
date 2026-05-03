/** Producer-side surface. Owns the send path and channel lifecycle. */
export interface IPublisher<T> {
  /** Enqueue msg for delivery to all subscribers. Fire-and-forget. */
  send(msg: T): void;
  /** Signal shutdown. Subsequent send() calls are no-ops. */
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

export class ControlChannel<T> implements IPublisher<T>, ISubscriber<T> {
  public send(_msg: T): void {
    throw new Error('not implemented');
  }

  public subscribe(_handler: (msg: T) => Promise<void>): void {
    throw new Error('not implemented');
  }

  public close(): void {
    throw new Error('not implemented');
  }

  public drain(): Promise<void> {
    throw new Error('not implemented');
  }
}
