import type { KeyAction } from '@shellicar/claude-core/input';
import { dependsOn } from '@shellicar/core-di-lite';
import { ConsumerChannel } from '../setup/ConsumerChannel.js';
import type { InputHandler } from './InputHandler.js';

/**
 * Owns the cancel concern: escape aborts the running turn by posting a cancel
 * on the injected consumer channel. This handler is in the primary's streaming
 * chain only, so escape reaches it only while a turn is running. The editor
 * chain has no CancelHandler, so editor-phase escape (command mode closed) is
 * unclaimed and posts nothing.
 */
export class CancelHandler implements InputHandler {
  @dependsOn(ConsumerChannel) private readonly channel!: ConsumerChannel;

  public handleKey(key: KeyAction): boolean {
    if (key.type === 'escape') {
      this.channel.send({ type: 'cancel' });
      return true;
    }
    return false;
  }
}
