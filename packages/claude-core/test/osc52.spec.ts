import { describe, expect, it } from 'vitest';
import { osc52 } from '../src/ansi';

describe('osc52', () => {
  it('wraps a base64 payload in a clipboard-targeted sequence', () => {
    const expected = '\x1b]52;c;aGk=\x1b\\';
    const actual = osc52('hi');
    expect(actual).toBe(expected);
  });

  it('encodes multi-byte text as UTF-8 before base64', () => {
    const expected = '\x1b]52;c;4oKs\x1b\\';
    const actual = osc52('\u20ac');
    expect(actual).toBe(expected);
  });

  it('sends an empty payload for empty text', () => {
    const expected = '\x1b]52;c;\x1b\\';
    const actual = osc52('');
    expect(actual).toBe(expected);
  });

  it('encodes a newline rather than emitting it raw', () => {
    const expected = '\x1b]52;c;YQpi\x1b\\';
    const actual = osc52('a\nb');
    expect(actual).toBe(expected);
  });
});
