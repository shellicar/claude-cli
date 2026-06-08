import type { KeyAction } from '@shellicar/claude-core/input';

/**
 * Interprets a key and acts on stores. Returns true to claim the key (the
 * chain stops) or false to pass it down. A handler claims only the keys for
 * the concern it owns and touches only that concern's state. It never
 * references a view, the renderer, or another handler.
 */
export interface InputHandler {
  handleKey(key: KeyAction): boolean;
}
