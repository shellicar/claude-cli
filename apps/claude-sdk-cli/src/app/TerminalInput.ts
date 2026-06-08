import type { KeyAction } from '@shellicar/claude-core/input';
import type { ViewHost } from './ViewHost.js';

/** Forwards each translated key to the active presentation's chain via ViewHost. */
export class TerminalInput {
  readonly #host: ViewHost;

  public constructor(host: ViewHost) {
    this.#host = host;
  }

  public handle(key: KeyAction): void {
    this.#host.dispatchKey(key);
  }
}
