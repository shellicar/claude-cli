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
  | { type: 'ctrl+k' }
  | { type: 'ctrl+u' }
  | { type: 'ctrl+/' }
  | { type: 'escape' }
  | { type: 'page_up' }
  | { type: 'page_down' }
  | { type: 'shift+up' }
  | { type: 'shift+down' }
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
    appendFileSync('/tmp/claude-core-keys.log', `${ts} | ${hex} | ${JSON.stringify(raw)} | name=${key?.name} ctrl=${key?.ctrl} meta=${key?.meta} shift=${key?.shift}\n`);
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
      // Emacs navigation
      case 'a':
        return { type: 'home' };
      case 'e':
        return { type: 'end' };
      case 'b':
        return { type: 'left' };
      case 'f':
        return { type: 'right' };
      case 'k':
        return { type: 'ctrl+k' };
      case 'u':
        return { type: 'ctrl+u' };
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

  // option+left: iTerm2 direct sends meta+left; tmux translates to meta+b
  if (meta && (name === 'left' || name === 'b')) {
    return { type: 'ctrl+left' };
  }

  // option+right: iTerm2 direct sends meta+right; tmux translates to meta+f
  if (meta && (name === 'right' || name === 'f')) {
    return { type: 'ctrl+right' };
  }

  // option+d on macOS (iTerm2 without "alt sends escape") sends ∂ (U+2202)
  if (ch === '∂') {
    return { type: 'ctrl+delete' };
  }

  // CSI u format (Kitty keyboard protocol): ESC [ keycode ; modifier u
  // readline doesn't parse these, so handle them from the raw sequence
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching terminal escape sequences requires \x1b
  const csiU = sequence.match(/^\x1b\[(\d+);(\d+)u$/);
  if (csiU) {
    const keycode = Number(csiU[1]);
    const modifier = Number(csiU[2]);
    // modifier 5 = Ctrl, modifier 2 = Shift (both submit)
    if (keycode === 13 && (modifier === 5 || modifier === 2)) {
      return { type: 'ctrl+enter' };
    }
    // Ctrl+C / Ctrl+D: tmux with extended-keys csi-u sends these
    // as CSI u instead of the traditional 0x03 / 0x04 bytes
    if (keycode === 99 && modifier === 5) {
      return { type: 'ctrl+c' };
    }
    if (keycode === 100 && modifier === 5) {
      return { type: 'ctrl+d' };
    }
    if (keycode === 127 && modifier === 5) {
      return { type: 'ctrl+backspace' };
    }
    if (keycode === 47 && modifier === 5) {
      return { type: 'ctrl+/' };
    }
  }

  // xterm modifyOtherKeys format: ESC [ 27 ; modifier ; keycode ~
  // iTerm2 and other terminals use this when modifyOtherKeys is enabled
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching terminal escape sequences requires \x1b
  const modifyOtherKeys = sequence.match(/^\x1b\[27;(\d+);(\d+)~$/);
  if (modifyOtherKeys) {
    const modifier = Number(modifyOtherKeys[1]);
    const keycode = Number(modifyOtherKeys[2]);
    // modifier 5 = Ctrl, modifier 2 = Shift (both submit)
    if (keycode === 13 && (modifier === 5 || modifier === 2)) {
      return { type: 'ctrl+enter' };
    }
  }

  // Shift modifier handling (before named keys switch)
  if (key?.shift && !ctrl) {
    switch (name) {
      case 'up':
        return { type: 'shift+up' };
      case 'down':
        return { type: 'shift+down' };
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
    case 'pageup':
      return { type: 'page_up' };
    case 'pagedown':
      return { type: 'page_down' };
  }

  // Ctrl+/: most terminals send \x1f (ASCII Unit Separator)
  if (sequence === '\x1f') {
    return { type: 'ctrl+/' };
  }

  // Regular printable character (supports multi-byte Unicode like emoji)
  if (ch && [...ch].length === 1 && ch >= ' ') {
    return { type: 'char', value: ch };
  }

  // Unknown: only emit if we got some input we couldn't translate
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
