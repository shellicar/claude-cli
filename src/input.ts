/**
 * Raw mode stdin key parser.
 * Converts terminal escape sequences into named actions.
 */

import { appendFileSync } from 'node:fs';

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
  | { type: 'unknown'; raw: string };

export function parseKey(data: string): KeyAction {
  const hex = [...data].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ');
  appendFileSync('/tmp/claude-cli-keys.log', `${hex} | ${JSON.stringify(data)}\n`);

  // Ctrl+C
  if (data === '\x03') return { type: 'ctrl+c' };

  // Ctrl+Delete: tmux sends ESC+d (\x1Bd)
  if (data === '\x1Bd') return { type: 'ctrl+delete' };

  // Ctrl+Enter (some terminals send \x0A with ctrl, others \x1B\x0A)
  if (data === '\x1B\n' || data === '\x1B\r') return { type: 'ctrl+enter' };

  // Enter
  if (data === '\r' || data === '\n') return { type: 'enter' };

  // Ctrl+Backspace (ESC + DEL in many terminals)
  // tmux sends Ctrl+W (\x17) for Ctrl+Backspace
  if (data === '\x1B\x7F' || data === '\x1B\x08' || data === '\x17') return { type: 'ctrl+backspace' };

  // Backspace
  if (data === '\x7F' || data === '\x08') return { type: 'backspace' };

  // Escape sequences
  if (data.startsWith('\x1B')) {
    return parseEscapeSequence(data);
  }

  // Regular printable character
  if (data.length === 1 && data >= ' ') return { type: 'char', value: data };

  // Multi-byte UTF-8 character
  if (data.length > 1 && !data.startsWith('\x1B')) return { type: 'char', value: data };

  return { type: 'unknown', raw: JSON.stringify(data) };
}

function parseEscapeSequence(data: string): KeyAction {
  // CSI sequences: ESC [ ...
  if (data.startsWith('\x1B[')) {
    const seq = data.slice(2);

    // Arrow keys
    if (seq === 'A') return { type: 'up' };
    if (seq === 'B') return { type: 'down' };
    if (seq === 'C') return { type: 'right' };
    if (seq === 'D') return { type: 'left' };

    // Home / End
    if (seq === 'H') return { type: 'home' };
    if (seq === 'F') return { type: 'end' };

    // Home / End (alternate: ESC [ 1 ~ and ESC [ 4 ~)
    if (seq === '1~') return { type: 'home' };
    if (seq === '4~') return { type: 'end' };

    // Delete: ESC [ 3 ~
    if (seq === '3~') return { type: 'delete' };

    // Ctrl+Delete: ESC [ 3 ; 5 ~
    if (seq === '3;5~') return { type: 'ctrl+delete' };

    // Ctrl+Home: ESC [ 1 ; 5 H
    if (seq === '1;5H') return { type: 'ctrl+home' };

    // Ctrl+End: ESC [ 1 ; 5 F
    if (seq === '1;5F') return { type: 'ctrl+end' };

    // Ctrl+Left: ESC [ 1 ; 5 D
    if (seq === '1;5D') return { type: 'ctrl+left' };

    // Ctrl+Right: ESC [ 1 ; 5 C
    if (seq === '1;5C') return { type: 'ctrl+right' };

    // CSI u format (modifyOtherKeys / kitty keyboard protocol)
    // Format: ESC [ <keycode> ; <modifier> u
    // Modifier 5 = Ctrl, 3 = Alt, 2 = Shift
    const csiU = seq.match(/^(\d+);(\d+)u$/);
    if (csiU) {
      const keycode = Number(csiU[1]);
      const modifier = Number(csiU[2]);
      // Ctrl+Enter: keycode 13 (CR), modifier 5 (Ctrl)
      if (keycode === 13 && modifier === 5) return { type: 'ctrl+enter' };
      // Ctrl+Backspace: keycode 127 (DEL), modifier 5 (Ctrl)
      if (keycode === 127 && modifier === 5) return { type: 'ctrl+backspace' };
    }
  }

  return { type: 'unknown', raw: JSON.stringify(data) };
}
