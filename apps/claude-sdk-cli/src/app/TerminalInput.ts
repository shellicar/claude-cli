import type { KeyAction } from '@shellicar/claude-core/input';
import { dependsOn } from '@shellicar/core-di-lite';
import { ViewHost } from './ViewHost.js';

/** Forwards each translated key to the active presentation's chain via ViewHost. */
export class TerminalInput {
  @dependsOn(ViewHost) private readonly host!: ViewHost;

  public handle(key: KeyAction): void {
    this.host.dispatchKey(key);
  }
}
