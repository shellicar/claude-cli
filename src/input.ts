/**
 * Keyboard input handler using Node's readline keypress parser.
 * Translates Node keypress events into named KeyAction types.
 *
 * Uses readline.emitKeypressEvents() which handles:
 * - CSI sequences (\x1b[A) and SS3/application mode (\x1bOA)
 * - Modifier keys (Ctrl, Alt, Shift) with proper detection
 * - Partial escape sequence buffering with timeout
 * - F-keys, Home, End, Delete, Insert, PageUp, PageDown
 * - Kitty keyboard protocol (CSI u format)
 * - Paste bracket mode
 */

import { appendFileSync } from 'node:fs';
import readline from 'node:readline';

export type KeyAction =
  | { type: 'char'; value: string }
  | { type: 'enter' }
  | { type: 'ctrl+enter' }
  | { type: 'backspace' }
  | { type: 'delete' }
  | { type: 'ctrl+delete' }
  | { type: 'ctrl+backspace' }
  | { type: 'left' }
  | { type: 'right' }
  | { type: 'up' }
  | { type: 'down' }
  | { type: 'home' }
  | { type: 'end' }
  | { type: 'ctrl+home' }
  | { type: 'ctrl+end' }
  | { type: 'ctrl+left' }
  | { type: 'ctrl+right' }
  | { type: 'ctrl+c' }
  | { type: 'ctrl+d' }
  | { type: 'escape' }
  | { type: 'unknown'; raw: string };

export interface NodeKey {
  sequence: string;
  name: string | undefined;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
}

/**
 * Translate a Node readline keypress event into our KeyAction type.
 */
export function translateKey(ch: string | undefined, key: NodeKey | undefined): KeyAction | null {
  // biome-ignore lint/suspicious/noConfusingLabels: esbuild dropLabels strips DEBUG blocks in production
  // biome-ignore lint/correctness/noUnusedLabels: esbuild dropLabels strips DEBUG blocks in production
  DEBUG: {
    const raw = key?.sequence ?? ch ?? '';
    const hex = [...raw].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ');
    const ts = new Date().toISOString();
    appendFileSync('/tmp/claude-cli-keys.log', `${ts} | ${hex} | ${JSON.stringify(raw)} | name=${key?.name} ctrl=${key?.ctrl} meta=${key?.meta} shift=${key?.shift}\n`);
  }

  const name = key?.name;
  const ctrl = key?.ctrl ?? false;
  const meta = key?.meta ?? false;
  const sequence = key?.sequence ?? ch ?? '';

  // Ctrl combinations
  if (ctrl) {
    switch (name) {
      case 'c':
        return { type: 'ctrl+c' };
      case 'd':
        return { type: 'ctrl+d' };
      case 'left':
        return { type: 'ctrl+left' };
      case 'right':
        return { type: 'ctrl+right' };
      case 'home':
        return { type: 'ctrl+home' };
      case 'end':
        return { type: 'ctrl+end' };
      case 'delete':
        return { type: 'ctrl+delete' };
      case 'backspace':
        return { type: 'ctrl+backspace' };
      case 'return':
        return { type: 'ctrl+enter' };
    }
  }

  // Ctrl+Backspace: tmux sends Ctrl+W (\x17)
  if (ctrl && name === 'w') {
    return { type: 'ctrl+backspace' };
  }

  // Ctrl+Delete: tmux sends ESC+d (\x1Bd), readline reports meta+d
  if (meta && name === 'd') {
    return { type: 'ctrl+delete' };
  }

  // Ctrl+Backspace: ESC+DEL (\x1B\x7F), readline may report meta+backspace
  if (meta && name === 'backspace') {
    return { type: 'ctrl+backspace' };
  }

  // CSI u format (Kitty keyboard protocol): ESC [ keycode ; modifier u
  // readline doesn't parse these, so handle them from the raw sequence
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching terminal escape sequences requires \x1b
  const csiU = sequence.match(/^\x1b\[(\d+);(\d+)u$/);
  if (csiU) {
    const keycode = Number(csiU[1]);
    const modifier = Number(csiU[2]);
    if (keycode === 13 && modifier === 5) {
      return { type: 'ctrl+enter' };
    }
    if (keycode === 127 && modifier === 5) {
      return { type: 'ctrl+backspace' };
    }
  }

  // Named keys (without modifiers)
  switch (name) {
    case 'return':
      return { type: 'enter' };
    case 'backspace':
      return { type: 'backspace' };
    case 'delete':
      return { type: 'delete' };
    case 'left':
      return { type: 'left' };
    case 'right':
      return { type: 'right' };
    case 'up':
      return { type: 'up' };
    case 'down':
      return { type: 'down' };
    case 'home':
      return { type: 'home' };
    case 'end':
      return { type: 'end' };
    case 'escape':
      return { type: 'escape' };
  }

  // Regular printable character (supports multi-byte Unicode like emoji)
  if (ch && [...ch].length === 1 && ch >= ' ') {
    return { type: 'char', value: ch };
  }

  // Unknown — only if we got some input we couldn't translate
  if (sequence) {
    return { type: 'unknown', raw: JSON.stringify(sequence) };
  }

  return null;
}

/**
 * Set up readline keypress events on stdin and call the handler for each translated KeyAction.
 * Returns a cleanup function to remove the listener.
 */
export function setupKeypressHandler(handler: (key: KeyAction) => void): () => void {
  readline.emitKeypressEvents(process.stdin);

  const onKeypress = (ch: string | undefined, key: NodeKey | undefined): void => {
    const action = translateKey(ch, key);
    if (action) {
      handler(action);
    }
  };

  process.stdin.on('keypress', onKeypress);

  return () => {
    process.stdin.removeListener('keypress', onKeypress);
  };
}
