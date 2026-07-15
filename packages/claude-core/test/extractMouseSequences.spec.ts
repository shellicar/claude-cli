import { describe, expect, it } from 'vitest';
import { extractMouseSequences, type KeyAction } from '../src/input';

const buf = (s: string): Buffer => Buffer.from(s, 'latin1');
const wheelUp = '\x1b[<64;10;5M';
const wheelDown = '\x1b[<65;10;5M';

describe('extractMouseSequences — wheel', () => {
  it('maps button 64 press to scroll_up', () => {
    const expected: KeyAction[] = [{ type: 'scroll_up' }];
    const actual = extractMouseSequences(buf(wheelUp)).actions;
    expect(actual).toEqual(expected);
  });

  it('maps button 65 press to scroll_down', () => {
    const expected: KeyAction[] = [{ type: 'scroll_down' }];
    const actual = extractMouseSequences(buf(wheelDown)).actions;
    expect(actual).toEqual(expected);
  });

  it('emits one action per wheel event in a burst', () => {
    const expected = 3;
    const actual = extractMouseSequences(buf(wheelUp + wheelUp + wheelDown)).actions.length;
    expect(actual).toBe(expected);
  });

  it('removes the wheel bytes from the passthrough', () => {
    const expected = '';
    const actual = extractMouseSequences(buf(wheelUp)).passthrough.toString('latin1');
    expect(actual).toBe(expected);
  });
});

describe('extractMouseSequences — non-wheel mouse', () => {
  it('swallows a left-button press (button 0) with no action', () => {
    const expected = 0;
    const actual = extractMouseSequences(buf('\x1b[<0;3;4M')).actions.length;
    expect(actual).toBe(expected);
  });

  it('swallows a button release (m) and passes nothing through', () => {
    const expected = '';
    const actual = extractMouseSequences(buf('\x1b[<0;3;4m')).passthrough.toString('latin1');
    expect(actual).toBe(expected);
  });
});

describe('extractMouseSequences — passthrough', () => {
  it('passes ordinary text straight through', () => {
    const expected = 'hello';
    const actual = extractMouseSequences(buf('hello')).passthrough.toString('latin1');
    expect(actual).toBe(expected);
  });

  it('passes a bare Escape (cancel key) straight through', () => {
    const expected = '\x1b';
    const actual = extractMouseSequences(buf('\x1b')).passthrough.toString('latin1');
    expect(actual).toBe(expected);
  });

  it('passes an arrow-key CSI sequence through untouched', () => {
    const expected = '\x1b[A';
    const actual = extractMouseSequences(buf('\x1b[A')).passthrough.toString('latin1');
    expect(actual).toBe(expected);
  });

  it('keeps text surrounding a wheel event in the passthrough', () => {
    const expected = 'ab';
    const actual = extractMouseSequences(buf(`a${wheelUp}b`)).passthrough.toString('latin1');
    expect(actual).toBe(expected);
  });

  it('preserves multi-byte UTF-8 bytes in the passthrough', () => {
    const emoji = Buffer.from('😀', 'utf8');
    const expected = emoji.toString('hex');
    const actual = extractMouseSequences(emoji).passthrough.toString('hex');
    expect(actual).toBe(expected);
  });
});

describe('extractMouseSequences — split across chunk boundaries', () => {
  it('holds an incomplete sequence as remainder', () => {
    const expected = '\x1b[<64;10';
    const actual = extractMouseSequences(buf('\x1b[<64;10')).remainder.toString('latin1');
    expect(actual).toBe(expected);
  });

  it('emits no action for the incomplete first half', () => {
    const expected = 0;
    const actual = extractMouseSequences(buf('\x1b[<64;10')).actions.length;
    expect(actual).toBe(expected);
  });

  it('completes the action once the remainder is prepended to the next chunk', () => {
    const first = extractMouseSequences(buf('\x1b[<64;10'));
    const joined = Buffer.concat([first.remainder, buf(';5M')]);
    const expected: KeyAction[] = [{ type: 'scroll_up' }];
    const actual = extractMouseSequences(joined).actions;
    expect(actual).toEqual(expected);
  });
});
