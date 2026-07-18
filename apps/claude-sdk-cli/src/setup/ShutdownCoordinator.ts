/**
 * The one seam between a keypress-time decision to quit and the process's actual shutdown sequence.
 * `QuitHandler` fires on a raw keypress, synchronously, long before `main`'s `cleanup` (which needs the
 * bus, the agent presence, and other runApp-scoped state) exists as a value it could be constructed
 * with. The coordinator lets `main` register that sequence once it is built, and lets any keypress-time
 * caller request it without knowing what it does \u2014 SIGINT, SIGTERM, and a wire `drain` all go through
 * the same `cleanup`; this is what lets ctrl+c join them instead of exiting around them.
 */
export abstract class IShutdownCoordinator {
  public abstract onRequest(handler: (reason: string) => void): void;
  public abstract request(reason: string): void;
}

export class ShutdownCoordinator extends IShutdownCoordinator {
  #handler: ((reason: string) => void) | null = null;

  public onRequest(handler: (reason: string) => void): void {
    this.#handler = handler;
  }

  public request(reason: string): void {
    this.#handler?.(reason);
  }
}
