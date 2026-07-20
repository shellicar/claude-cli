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

import readline from 'node:readline';
import { PassThrough } from 'node:stream';

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
  | { type: 'f1' }
  | { type: 'f2' }
  | { type: 'shift+up' }
  | { type: 'shift+down' }
  | { type: 'scroll_up' }
  | { type: 'scroll_down' }
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
    case 'f1':
      return { type: 'f1' };
    case 'f2':
      return { type: 'f2' };
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

const MOUSE_PREFIX = Buffer.from([0x1b, 0x5b, 0x3c]); // ESC [ <
const EMPTY = Buffer.alloc(0);

type MouseParse = { length: number; action: KeyAction | null } | 'incomplete';

/**
 * Parse one SGR mouse sequence (ESC [ < button ; x ; y M|m) starting at `start`,
 * where buf[start..start+3] is already known to be the `ESC [ <` prefix. Returns
 * 'incomplete' when the buffer ends mid-sequence (hold for the next chunk), else
 * the byte length consumed and the KeyAction it maps to (null = swallow). Wheel
 * up/down are button 64/65 with an 'M' (press) final byte; wheel has no release.
 */
function parseMouseAt(buf: Buffer, start: number): MouseParse {
  let k = start + 3;
  const digits = (): number | null => {
    let v = -1;
    while (k < buf.length && buf[k] >= 0x30 && buf[k] <= 0x39) {
      v = (v < 0 ? 0 : v) * 10 + (buf[k] - 0x30);
      k++;
    }
    return v < 0 ? null : v;
  };
  const button = digits();
  if (button === null) {
    return k >= buf.length ? 'incomplete' : { length: 3, action: null };
  }
  if (k >= buf.length) {
    return 'incomplete';
  }
  if (buf[k] !== 0x3b) {
    return { length: k - start, action: null };
  }
  k++;
  if (digits() === null) {
    return k >= buf.length ? 'incomplete' : { length: k - start, action: null };
  }
  if (k >= buf.length) {
    return 'incomplete';
  }
  if (buf[k] !== 0x3b) {
    return { length: k - start, action: null };
  }
  k++;
  if (digits() === null) {
    return k >= buf.length ? 'incomplete' : { length: k - start, action: null };
  }
  if (k >= buf.length) {
    return 'incomplete';
  }
  const final = buf[k];
  if (final !== 0x4d && final !== 0x6d) {
    return { length: k - start + 1, action: null };
  }
  k++;
  const action: KeyAction | null = final === 0x4d && button === 64 ? { type: 'scroll_up' } : final === 0x4d && button === 65 ? { type: 'scroll_down' } : null;
  return { length: k - start, action };
}

/**
 * Pull complete SGR mouse sequences out of a raw stdin buffer. readline shreds
 * mouse sequences into per-character keypress events, so they must be removed
 * before readline sees them. Wheel-up (button 64) and wheel-down (65) become
 * scroll actions; every other mouse event (clicks, drags, releases) is swallowed
 * so its bytes never leak as stray keypresses. Non-mouse bytes pass through
 * untouched. A sequence split across a chunk boundary is returned as `remainder`
 * to prepend to the next chunk. Only an unambiguous `ESC [ <` prefix is held
 * back; a bare trailing ESC (a real Escape key) passes straight through.
 */
export function extractMouseSequences(input: Buffer): { actions: KeyAction[]; passthrough: Buffer; remainder: Buffer } {
  const actions: KeyAction[] = [];
  const pass: Buffer[] = [];
  let i = 0;
  while (i < input.length) {
    const j = input.indexOf(MOUSE_PREFIX, i);
    if (j === -1) {
      pass.push(input.subarray(i));
      break;
    }
    if (j > i) {
      pass.push(input.subarray(i, j));
    }
    const parsed = parseMouseAt(input, j);
    if (parsed === 'incomplete') {
      return { actions, passthrough: pass.length ? Buffer.concat(pass) : EMPTY, remainder: input.subarray(j) };
    }
    if (parsed.action) {
      actions.push(parsed.action);
    }
    i = j + parsed.length;
  }
  return { actions, passthrough: pass.length ? Buffer.concat(pass) : EMPTY, remainder: EMPTY };
}

/**
 * Set up input handling on stdin and call the handler for each translated
 * KeyAction. Raw stdin is filtered for mouse sequences first (see
 * extractMouseSequences), then the non-mouse bytes flow through a PassThrough
 * into readline's keypress parser exactly as before. Returns a cleanup function.
 *
 * One case is special-cased ahead of readline: a chunk containing nothing but a
 * single ESC byte (0x1b). readline cannot tell a bare Escape keypress from the
 * start of a CSI/SS3 sequence (arrow keys, etc., which also start with ESC), so
 * it holds the byte for ~500ms waiting to see if more follows — measured (see
 * the ESC-cancel-lag investigation) as the entire source of a perceived cancel
 * delay. A real terminal writes an escape sequence as one atomic chunk over the
 * pty, so a chunk that is *only* the ESC byte can never be the start of one —
 * there is nothing left in the chunk to complete it. That makes emitting escape
 * immediately here safe, without waiting on readline at all.
 */
export function setupKeypressHandler(handler: (key: KeyAction) => void): () => void {
  const passthrough = new PassThrough();
  readline.emitKeypressEvents(passthrough);

  let leftover: Buffer = EMPTY;
  const onData = (chunk: Buffer): void => {
    const { actions, passthrough: pass, remainder } = extractMouseSequences(leftover.length ? Buffer.concat([leftover, chunk]) : chunk);
    leftover = remainder;
    for (const action of actions) {
      handler(action);
    }
    if (pass.length === 1 && pass[0] === 0x1b) {
      handler({ type: 'escape' });
      return;
    }
    if (pass.length) {
      passthrough.write(pass);
    }
  };

  const onKeypress = (ch: string | undefined, key: NodeKey | undefined): void => {
    const action = translateKey(ch, key);
    if (action) {
      handler(action);
    }
  };

  passthrough.on('keypress', onKeypress);
  process.stdin.on('data', onData);

  return () => {
    process.stdin.removeListener('data', onData);
    passthrough.removeListener('keypress', onKeypress);
    passthrough.destroy();
  };
}
